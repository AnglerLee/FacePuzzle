// 키 없이 열린 API 를 지키는 방어 계층: 출처 검사, 본문 크기·시간 제한, IP별·전역 속도 제한, 동시 업로드 제한.
// 상한값은 shared/limits.ts 에 있다.
import type { ApiErrorBody, ApiErrorCode } from "@shared/types";
import { LIMITS, RATE } from "@shared/limits";
import { RateLimiter, takeAll, type LimitCheck } from "./rate-limit";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function errorResponse(error: HttpError): Response {
  const body: ApiErrorBody = { error: error.code, message: error.message };
  return Response.json(body, { status: error.status, headers: error.headers });
}

// ── 경고 로그: 같은 종류는 분당 한 번만 남긴다 (공격받을 때 로그가 넘치지 않게) ──
const lastWarn = new Map<string, number>();
const suppressed = new Map<string, number>();
export function warnOnce(kind: string, detail: string, now = Date.now()): void {
  const last = lastWarn.get(kind) ?? 0;
  if (now - last < 60_000) {
    suppressed.set(kind, (suppressed.get(kind) ?? 0) + 1);
    return;
  }
  const skipped = suppressed.get(kind) ?? 0;
  suppressed.delete(kind);
  lastWarn.set(kind, now);
  console.warn(`[facepuzzle] ${kind}: ${detail}${skipped ? ` (지난 1분간 ${skipped}건 더)` : ""}`);
}

// ── 클라이언트 IP ──
/** DSM 리버스 프록시가 넣는 X-Real-IP, 없으면 X-Forwarded-For 첫 값. 위조될 수 있으므로 전역 제한이 따로 있다 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || "unknown").slice(0, 64);
}

// ── 출처 검사 ──
/**
 * 다른 사이트가 방문자 브라우저를 시켜 쓰기 요청을 보내지 못하게 한다.
 * 브라우저가 Sec-Fetch-Site 를 보내면 same-origin 이어야 하고, Origin 만 보내면 호스트가 같아야 한다.
 * 둘 다 없으면 브라우저가 아닌 클라이언트다 — 그쪽은 속도 제한·할당량이 막는다.
 */
export function assertSameOrigin(req: Request): void {
  const site = req.headers.get("sec-fetch-site");
  if (site) {
    if (site === "same-origin") return;
    throw new HttpError(403, "forbidden", "다른 사이트에서 보낸 요청은 받지 않아요");
  }
  const origin = req.headers.get("origin");
  if (!origin) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "forbidden", "출처를 알 수 없는 요청이에요");
  }
  const hosts = [req.headers.get("x-forwarded-host"), req.headers.get("host")]
    .flatMap((h) => (h ? h.split(",").map((s) => s.trim()) : []))
    .filter(Boolean);
  if (!hosts.includes(originHost)) {
    throw new HttpError(403, "forbidden", "다른 사이트에서 보낸 요청은 받지 않아요");
  }
}

// ── 본문 읽기 ──
/**
 * Content-Length 가 있으면 먼저 거르고, 스트림으로 읽으면서 상한·시간을 다시 지킨다.
 * 프록시를 거치며 chunked 로 바뀌어 Content-Length 가 없을 수도 있어서, 없을 때는 스트림 상한만으로 막는다.
 */
export async function readBodyLimited(req: Request, maxBytes: number, timeoutMs: number = LIMITS.bodyTimeoutMs): Promise<Uint8Array> {
  const lengthHeader = req.headers.get("content-length");
  if (lengthHeader !== null) {
    const declared = Number(lengthHeader);
    if (!Number.isInteger(declared) || declared < 0) throw new HttpError(400, "bad_request", "본문 크기가 이상해요");
    if (declared > maxBytes) throw new HttpError(413, "too_large", "그림이 너무 커요");
    if (declared === 0) throw new HttpError(400, "bad_request", "보낸 내용이 비어 있어요");
  }
  if (!req.body) throw new HttpError(400, "bad_request", "보낸 내용이 비어 있어요");

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch(() => undefined);
  }, timeoutMs);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (timedOut) throw new HttpError(408, "timeout", "보내는 데 너무 오래 걸렸어요");
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError(413, "too_large", "그림이 너무 커요");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (timedOut) throw new HttpError(408, "timeout", "보내는 데 너무 오래 걸렸어요");
    throw new HttpError(400, "bad_request", "보낸 내용을 읽지 못했어요");
  } finally {
    clearTimeout(timer);
  }
  if (total === 0) throw new HttpError(400, "bad_request", "보낸 내용이 비어 있어요");
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function readJsonLimited(req: Request): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new HttpError(400, "bad_request", "JSON 으로 보내 주세요");
  }
  const bytes = await readBodyLimited(req, LIMITS.jsonMaxBytes);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError(400, "bad_request", "JSON 을 읽지 못했어요");
  }
}

// ── 속도 제한 ──
export const limiters = {
  uploadIp: new RateLimiter("uploadIp", RATE.uploadIp),
  uploadIpDaily: new RateLimiter("uploadIpDaily", RATE.uploadIpDaily),
  uploadGlobal: new RateLimiter("uploadGlobal", RATE.uploadGlobal),
  uploadGlobalDaily: new RateLimiter("uploadGlobalDaily", RATE.uploadGlobalDaily),
  albumIp: new RateLimiter("albumIp", RATE.albumIp),
  authorIp: new RateLimiter("authorIp", RATE.authorIp),
  removeIp: new RateLimiter("removeIp", RATE.removeIp),
  bulkIp: new RateLimiter("bulkIp", RATE.bulkIp),
  writeGlobal: new RateLimiter("writeGlobal", RATE.writeGlobal),
  stateIp: new RateLimiter("stateIp", RATE.stateIp),
  imageIp: new RateLimiter("imageIp", RATE.imageIp),
};

export type LimitKind = "upload" | "album" | "author" | "remove" | "bulk" | "state" | "image";

const GLOBAL = "*";

function checksFor(kind: LimitKind, ip: string): LimitCheck[] {
  const l = limiters;
  switch (kind) {
    case "upload":
      return [
        { limiter: l.uploadIp, key: ip },
        { limiter: l.uploadIpDaily, key: ip },
        { limiter: l.uploadGlobal, key: GLOBAL },
        { limiter: l.uploadGlobalDaily, key: GLOBAL },
        { limiter: l.writeGlobal, key: GLOBAL },
      ];
    case "album":
      return [{ limiter: l.albumIp, key: ip }, { limiter: l.writeGlobal, key: GLOBAL }];
    case "author":
      return [{ limiter: l.authorIp, key: ip }, { limiter: l.writeGlobal, key: GLOBAL }];
    case "remove":
      return [{ limiter: l.removeIp, key: ip }, { limiter: l.writeGlobal, key: GLOBAL }];
    case "bulk":
      return [{ limiter: l.bulkIp, key: ip }, { limiter: l.writeGlobal, key: GLOBAL }];
    case "state":
      return [{ limiter: l.stateIp, key: ip }];
    case "image":
      return [{ limiter: l.imageIp, key: ip }];
  }
}

export function assertRate(req: Request, kind: LimitKind, now = Date.now()): void {
  const ip = clientIp(req);
  const { waitMs, blockedBy } = takeAll(checksFor(kind, ip), now);
  if (waitMs > 0) {
    const retryAfter = Math.max(1, Math.ceil(waitMs / 1000));
    warnOnce(`rate:${blockedBy}`, `ip=${ip} ${retryAfter}s`, now);
    throw new HttpError(429, "rate_limited", "너무 빨라요! 잠깐 쉬었다가 다시 해요", {
      "Retry-After": String(retryAfter),
    });
  }
}

// ── 동시 업로드 ──
let activeUploads = 0;

export async function withUploadSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeUploads >= LIMITS.maxConcurrentUploads) {
    warnOnce("busy", `active=${activeUploads}`);
    throw new HttpError(503, "busy", "지금 저장하는 그림이 많아요. 다시 눌러 주세요", { "Retry-After": "2" });
  }
  activeUploads++;
  try {
    return await fn();
  } finally {
    activeUploads--;
  }
}

/** 테스트용: 속도 제한·동시성 상태를 비운다 */
export function resetGuardForTests(): void {
  for (const limiter of Object.values(limiters)) limiter.reset();
  activeUploads = 0;
  lastWarn.clear();
  suppressed.clear();
}
