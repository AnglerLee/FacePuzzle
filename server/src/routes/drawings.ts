import { LIMITS } from "@shared/limits";
import { isPartId } from "@shared/parts";
import { readPngHeader } from "@shared/png";
import { isId, parseBulkHideInput, parseBulkRestoreInput } from "@shared/types";
import { assertRate, assertSameOrigin, HttpError, readBodyLimited, readJsonLimited, withUploadSlot } from "../_server/guard";
import {
  addDrawing,
  expectedSize,
  hideDrawing,
  hideDrawingsOfParts,
  readDrawing,
  restoreDrawing,
  restoreDrawingsHiddenAt,
} from "../_server/store";
import { json, requireId } from "./handle";

/** POST /api/facepuzzle/drawings?part=eyes&author=<id>  본문: image/png */
export async function POST(req: Request): Promise<Response> {
  assertSameOrigin(req);
  const url = new URL(req.url);
  const part = url.searchParams.get("part");
  if (!isPartId(part)) throw new HttpError(400, "bad_request", "어느 부위인지 알 수 없어요");
  const authorParam = url.searchParams.get("author");
  if (authorParam && !isId(authorParam)) throw new HttpError(400, "bad_request", "그린 사람을 알 수 없어요");
  if ((req.headers.get("content-type") ?? "").toLowerCase() !== "image/png") {
    throw new HttpError(400, "bad_request", "PNG 그림만 받아요");
  }
  assertRate(req, "upload");
  return withUploadSlot(async () => {
    const png = await readBodyLimited(req, LIMITS.pngMaxBytes);
    const header = readPngHeader(png);
    if (!header) throw new HttpError(400, "bad_request", "올바른 PNG 그림이 아니에요");
    const size = expectedSize(part);
    if (header.width !== size.width || header.height !== size.height) {
      throw new HttpError(400, "bad_request", "그림 크기가 이 부위와 맞지 않아요");
    }
    const drawing = await addDrawing(png, part, authorParam || null);
    return json(drawing, 201);
  });
}

/** GET /api/facepuzzle/drawings/<id>.png */
export async function GET_IMAGE(req: Request, file: string | undefined): Promise<Response> {
  const match = /^([0-9a-f]{16})\.png$/.exec(file ?? "");
  if (!match) throw new HttpError(404, "not_found", "그림을 찾지 못했어요");
  assertRate(req, "image");
  const buf = await readDrawing(match[1]);
  if (!buf) throw new HttpError(404, "not_found", "그림을 찾지 못했어요");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(buf.byteLength),
      // id 마다 내용이 바뀌지 않는다
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}

export async function DELETE(req: Request, id: string | undefined): Promise<Response> {
  assertSameOrigin(req);
  const drawingId = requireId(id, "그림");
  assertRate(req, "remove");
  return json(await hideDrawing(drawingId));
}

export async function RESTORE(req: Request, id: string | undefined): Promise<Response> {
  assertSameOrigin(req);
  const drawingId = requireId(id, "그림");
  assertRate(req, "remove");
  return json(await restoreDrawing(drawingId));
}

/** POST /api/facepuzzle/drawings/hide  본문: { parts: ["eyes", …] } — 설정의 [그린 그림 초기화] */
export async function HIDE_MANY(req: Request): Promise<Response> {
  assertSameOrigin(req);
  assertRate(req, "bulk");
  const input = parseBulkHideInput(await readJsonLimited(req));
  if (!input) throw new HttpError(400, "bad_request", "어느 부위 그림을 지울지 알 수 없어요");
  return json(await hideDrawingsOfParts(input.parts));
}

/** POST /api/facepuzzle/drawings/restore  본문: { hiddenAt } — 한꺼번에 지운 그림을 한 번에 되살리기 */
export async function RESTORE_MANY(req: Request): Promise<Response> {
  assertSameOrigin(req);
  assertRate(req, "bulk");
  const input = parseBulkRestoreInput(await readJsonLimited(req));
  if (!input) throw new HttpError(400, "bad_request", "되살릴 그림을 알 수 없어요");
  return json(await restoreDrawingsHiddenAt(input.hiddenAt));
}
