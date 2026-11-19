import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LIMITS } from "@shared/limits";
import type { Author, Drawing, FaceState } from "@shared/types";
import app from "../app";
import { readBodyLimited, resetGuardForTests } from "../_server/guard";
import { addDrawing, drawingFile, getState, resetStoreForTests } from "../_server/store";
import { makePng } from "../test/png";

const HOST = "pros2.test";
const BASE = `http://${HOST}/api/facepuzzle`;
const EYES = () => makePng(620, 260);
const NOSE = () => makePng(220, 200);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "facepuzzle-"));
  process.env.DATA_DIR = dir;
  resetGuardForTests();
  resetStoreForTests();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

interface Opts {
  ip?: string;
  site?: string | null;
  origin?: string;
  headers?: Record<string, string>;
}

function headers({ ip = "10.0.0.1", site = "same-origin", origin, headers: extra = {} }: Opts = {}) {
  const h: Record<string, string> = { host: HOST, "x-real-ip": ip, ...extra };
  if (site) h["sec-fetch-site"] = site;
  if (origin) h.origin = origin;
  return h;
}

function upload(part: string, png: Uint8Array<ArrayBuffer>, opts: Opts & { author?: string; length?: boolean } = {}) {
  const query = `part=${part}${opts.author ? `&author=${opts.author}` : ""}`;
  return app.request(`${BASE}/drawings?${query}`, {
    method: "POST",
    headers: {
      "content-type": "image/png",
      ...(opts.length === false ? {} : { "content-length": String(png.byteLength) }),
      ...headers(opts),
    },
    body: png,
  });
}

function send(method: string, url: string, body?: unknown, opts: Opts = {}) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return app.request(`${BASE}${url}`, {
    method,
    headers: {
      ...headers(opts),
      ...(text ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) } : {}),
    },
    body: text,
  });
}

async function state(ip = "10.0.0.250"): Promise<FaceState> {
  const res = await app.request(`${BASE}/state`, { headers: headers({ ip }) });
  expect(res.status).toBe(200);
  return res.json();
}

describe("상태", () => {
  it("처음 읽을 때 기본 작가 3명을 만들고, 다시 읽어도 id 가 같다", async () => {
    const first = await state();
    expect(first.authors.map((a) => a.name)).toEqual(["나", "엄마", "아빠"]);
    const second = await state();
    expect(second.authors.map((a) => a.id)).toEqual(first.authors.map((a) => a.id));
  });

  it("상태 읽기도 IP별로 제한한다", async () => {
    for (let i = 0; i < 30; i++) {
      const res = await app.request(`${BASE}/state`, { headers: headers({ ip: "9.9.9.9" }) });
      expect(res.status).toBe(200);
    }
    const res = await app.request(`${BASE}/state`, { headers: headers({ ip: "9.9.9.9" }) });
    expect(res.status).toBe(429);
  });
});

describe("그림 올리기", () => {
  it("맞는 크기의 PNG 를 저장하고 이미지로 돌려준다", async () => {
    const author = (await state()).authors[0];
    const res = await upload("eyes", EYES(), { author: author.id });
    expect(res.status).toBe(201);
    const drawing: Drawing = await res.json();
    expect(drawing).toMatchObject({ part: "eyes", authorId: author.id });

    const img = await app.request(`${BASE}/drawings/${drawing.id}.png`, { headers: headers() });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(img.headers.get("cache-control")).toContain("immutable");
    expect((await state()).drawings).toHaveLength(1);
  });

  it("크기가 다르거나 PNG 가 아니면 400", async () => {
    expect((await upload("eyes", NOSE())).status).toBe(400);
    expect((await upload("eyes", new TextEncoder().encode("<html>".padEnd(200, "x")))).status).toBe(400);
    expect((await upload("tail", EYES())).status).toBe(400);
    expect((await upload("eyes", EYES(), { author: "../../x" })).status).toBe(400);
    expect((await upload("eyes", EYES(), { author: "0123456789abcdef" })).status).toBe(400);
    const wrongType = await app.request(`${BASE}/drawings?part=eyes`, {
      method: "POST",
      headers: { "content-type": "text/plain", ...headers() },
      body: EYES(),
    });
    expect(wrongType.status).toBe(400);
    expect((await state()).drawings).toHaveLength(0);
  });

  it("너무 크면 413 — Content-Length 가 있으면 읽기 전에, 없으면 읽다가 끊는다", async () => {
    const big = makePng(620, 200, { padTo: LIMITS.pngMaxBytes });
    expect((await upload("eyes", big)).status).toBe(413);
    expect((await upload("eyes", big, { length: false })).status).toBe(413);
    // Content-Length 가 없어도 크기 안이면 받는다 (프록시가 chunked 로 바꾼 경우)
    expect((await upload("eyes", EYES(), { length: false })).status).toBe(201);
  });

  it("본문이 너무 늦게 오면 408", async () => {
    const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined) });
    const req = new Request(`${BASE}/drawings`, { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(readBodyLimited(req, 1000, 30)).rejects.toMatchObject({ status: 408 });
  });

  it("경로 조작은 404", async () => {
    for (const bad of ["..%2F..%2Fetc%2Fpasswd", "0123456789abcdef.svg", "0123456789ABCDEF.png"]) {
      const res = await app.request(`${BASE}/drawings/${bad}`, { headers: headers() });
      expect(res.status).toBe(404);
    }
  });
});

describe("출처 검사", () => {
  it("다른 사이트에서 온 쓰기는 403", async () => {
    expect((await upload("eyes", EYES(), { site: "cross-site" })).status).toBe(403);
    expect((await upload("eyes", EYES(), { site: null, origin: "https://evil.example" })).status).toBe(403);
    expect((await send("POST", "/album", { name: "x", parts: { eyes: "sample-0" } }, { site: "cross-site" })).status).toBe(403);
  });

  it("같은 호스트의 Origin 이나 브라우저가 아닌 요청은 통과", async () => {
    expect((await upload("eyes", EYES(), { site: null, origin: `https://${HOST}` })).status).toBe(201);
    expect(
      (await upload("eyes", EYES(), { site: null, origin: "https://pros2.synology.me", headers: { "x-forwarded-host": "pros2.synology.me" } }))
        .status,
    ).toBe(201);
    expect((await upload("eyes", EYES(), { site: null })).status).toBe(201);
  });
});

describe("속도 제한", () => {
  it("한 IP 는 분당 10장까지, 다른 IP 는 따로 센다", async () => {
    for (let i = 0; i < 10; i++) expect((await upload("eyes", EYES(), { ip: "1.1.1.1" })).status).toBe(201);
    const blocked = await upload("eyes", EYES(), { ip: "1.1.1.1" });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await upload("eyes", EYES(), { ip: "2.2.2.2" })).status).toBe(201);
  });

  it("IP 를 바꿔도 전체 분당 60장을 넘지 못한다", async () => {
    let ok = 0;
    for (let i = 0; i < 70; i++) {
      const res = await upload("nose", NOSE(), { ip: `5.5.5.${i}` });
      if (res.status === 201) ok++;
      else expect(res.status).toBe(429);
    }
    expect(ok).toBe(60);
  });

  it("동시에 3장을 받는 중이면 4번째는 503", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = () =>
      app.request(`${BASE}/drawings?part=eyes`, {
        method: "POST",
        headers: { "content-type": "image/png", ...headers({ ip: "7.7.7.7" }) },
        body: new ReadableStream<Uint8Array>({
          async pull(ctrl) {
            await gate;
            ctrl.enqueue(EYES());
            ctrl.close();
          },
        }),
        duplex: "half",
      } as RequestInit);
    const pending = [slow(), slow(), slow()];
    await new Promise((r) => setTimeout(r, 20));
    const busy = await upload("eyes", EYES(), { ip: "8.8.8.8" });
    expect(busy.status).toBe(503);
    release();
    expect((await Promise.all(pending)).map((r) => r.status)).toEqual([201, 201, 201]);
  });
});

describe("할당량", () => {
  it("부위별 150장이 차면 409 full", async () => {
    for (let i = 0; i < LIMITS.perPartActive; i++) await addDrawing(EYES(), "eyes", null);
    const res = await upload("eyes", EYES());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("full");
    // 다른 부위는 아직 된다
    expect((await upload("nose", NOSE())).status).toBe(201);
  });

  it("동시에 저장해도 목록이 깨지지 않는다", async () => {
    await Promise.all(Array.from({ length: 12 }, () => addDrawing(NOSE(), "nose", null)));
    const s = await state();
    expect(s.drawings).toHaveLength(12);
    expect(new Set(s.drawings.map((d) => d.id)).size).toBe(12);
  });

  it("작가는 12명까지", async () => {
    const base = (await state()).authors.length;
    for (let i = base; i < LIMITS.authorsMax; i++) {
      const res = await send("POST", "/authors", { name: `가족${i}`, emoji: "🐱", color: "#3a86ff" }, { ip: `3.3.3.${i}` });
      expect(res.status).toBe(201);
    }
    const res = await send("POST", "/authors", { name: "한 명 더", emoji: "🐱", color: "#3a86ff" }, { ip: "3.3.4.1" });
    expect(res.status).toBe(409);
  });
});

describe("지우기와 휴지통", () => {
  it("지우면 숨기고, 되살릴 수 있고, 30일이 지나면 파일까지 정리한다", async () => {
    const drawing: Drawing = await (await upload("eyes", EYES())).json();
    const hidden: Drawing = await (await send("DELETE", `/drawings/${drawing.id}`)).json();
    expect(hidden.hiddenAt).toBeTruthy();
    const restored: Drawing = await (await send("POST", `/drawings/${drawing.id}/restore`)).json();
    expect(restored.hiddenAt).toBeUndefined();

    await send("DELETE", `/drawings/${drawing.id}`);
    const later = new Date(Date.now() + (LIMITS.trashDays + 1) * 86_400_000);
    const s = await getState(later);
    expect(s.drawings).toHaveLength(0);
    await expect(stat(drawingFile(drawing.id))).rejects.toThrow();
  });

  it("보이는 앨범이 쓰는 그림은 30일이 지나도 남긴다", async () => {
    const drawing: Drawing = await (await upload("eyes", EYES())).json();
    const entry = await send("POST", "/album", { name: "웃는 감자", parts: { eyes: drawing.id, nose: "sample-0" } });
    expect(entry.status).toBe(201);
    await send("DELETE", `/drawings/${drawing.id}`);
    const later = new Date(Date.now() + (LIMITS.trashDays + 1) * 86_400_000);
    expect((await getState(later)).drawings).toHaveLength(1);
  });

  it("마지막 작가는 숨길 수 없다", async () => {
    const authors: Author[] = (await state()).authors;
    expect((await send("DELETE", `/authors/${authors[0].id}`)).status).toBe(200);
    expect((await send("DELETE", `/authors/${authors[1].id}`)).status).toBe(200);
    expect((await send("DELETE", `/authors/${authors[2].id}`)).status).toBe(400);
  });
});

describe("앨범", () => {
  it("담고, 이름을 바꾸고, 없는 그림은 거절한다", async () => {
    const created = await send("POST", "/album", { name: "  졸린  만두 ", parts: { eyes: "sample-1", mouth: "sample-0" } });
    expect(created.status).toBe(201);
    const entry = await created.json();
    expect(entry.name).toBe("졸린 만두");
    const renamed = await send("PATCH", `/album/${entry.id}`, { name: "신난 만두" });
    expect((await renamed.json()).name).toBe("신난 만두");
    const missing = await send("POST", "/album", { name: "x", parts: { eyes: "0123456789abcdef" } });
    expect(missing.status).toBe(400);
  });

  it("JSON 본문이 8KB 를 넘으면 413", async () => {
    const res = await send("POST", "/album", { name: "x".repeat(LIMITS.jsonMaxBytes), parts: { eyes: "sample-0" } });
    expect(res.status).toBe(413);
  });
});
