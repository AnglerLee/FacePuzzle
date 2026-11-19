import { parseAuthorInput, type AuthorInput } from "@shared/types";
import { assertRate, assertSameOrigin, HttpError, readJsonLimited } from "../_server/guard";
import { addAuthor, hideAuthor, restoreAuthor, updateAuthor } from "../_server/store";
import { json, requireId } from "./handle";

const bad = () => new HttpError(400, "bad_request", "이름·얼굴·색을 다시 골라 주세요");

export async function POST(req: Request): Promise<Response> {
  assertSameOrigin(req);
  assertRate(req, "author");
  const input = parseAuthorInput(await readJsonLimited(req));
  if (!input) throw bad();
  return json(await addAuthor(input as AuthorInput), 201);
}

export async function PATCH(req: Request, id: string | undefined): Promise<Response> {
  assertSameOrigin(req);
  const authorId = requireId(id, "그린 사람");
  assertRate(req, "author");
  const input = parseAuthorInput(await readJsonLimited(req), true);
  if (!input) throw bad();
  return json(await updateAuthor(authorId, input));
}

export async function DELETE(req: Request, id: string | undefined): Promise<Response> {
  assertSameOrigin(req);
  const authorId = requireId(id, "그린 사람");
  assertRate(req, "remove");
  return json(await hideAuthor(authorId));
}

export async function RESTORE(req: Request, id: string | undefined): Promise<Response> {
  assertSameOrigin(req);
  const authorId = requireId(id, "그린 사람");
  assertRate(req, "remove");
  return json(await restoreAuthor(authorId));
}
