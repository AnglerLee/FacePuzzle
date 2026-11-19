import { LIMITS } from "@shared/limits";
import { cleanText, parseAlbumInput } from "@shared/types";
import { assertRate, assertSameOrigin, HttpError, readJsonLimited } from "../_server/guard";
import { addAlbum, hideAlbum, renameAlbum, restoreAlbum } from "../_server/store";
import { json, requireId } from "./handle";

export async function POST(req: Request): Promise<Response> {
  assertSameOrigin(req);
  assertRate(req, "album");
  const input = parseAlbumInput(await readJsonLimited(req));
  if (!input) throw new HttpError(400, "bad_request", "앨범에 담을 얼굴이 이상해요");
  return json(await addAlbum(input), 201);
}

export async function PATCH(req: Request, id: string | undefined): Promise<Response> {
  assertSameOrigin(req);
  const entryId = requireId(id, "앨범 얼굴");
  assertRate(req, "album");
  const body = (await readJsonLimited(req)) as { name?: unknown } | null;
  const name = cleanText(body?.name, LIMITS.albumNameMax);
  if (!name) throw new HttpError(400, "bad_request", "이름을 적어 주세요");
  return json(await renameAlbum(entryId, name));
}

export async function DELETE(req: Request, id: string | undefined): Promise<Response> {
  assertSameOrigin(req);
  const entryId = requireId(id, "앨범 얼굴");
  assertRate(req, "remove");
  return json(await hideAlbum(entryId));
}

export async function RESTORE(req: Request, id: string | undefined): Promise<Response> {
  assertSameOrigin(req);
  const entryId = requireId(id, "앨범 얼굴");
  assertRate(req, "remove");
  return json(await restoreAlbum(entryId));
}
