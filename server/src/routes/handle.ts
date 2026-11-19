import { errorResponse, HttpError } from "../_server/guard";

/** 라우트 공통: HttpError 는 그대로 응답으로, 나머지는 500 으로 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    console.error("[facepuzzle] 처리하지 못한 오류", error);
    return Response.json({ error: "server", message: "서버에 문제가 생겼어요" }, { status: 500 });
  }
}

export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export function requireId(id: string | undefined, what: string): string {
  if (!id || !/^[0-9a-f]{16}$/.test(id)) throw new HttpError(404, "not_found", `${what}을(를) 찾지 못했어요`);
  return id;
}
