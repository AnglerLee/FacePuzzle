// /api/facepuzzle 호출. 실패는 ApiError 로 바꾸고, 아이가 알아볼 수 있는 문구는 friendlyError 로 만든다.
import type { PartId } from "@shared/parts";
import type {
  AlbumEntry,
  AlbumInput,
  ApiErrorBody,
  Author,
  AuthorInput,
  Drawing,
  FaceState,
} from "@shared/types";

const API = "/api/facepuzzle";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSec: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: BodyInit, contentType?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + path, {
      method,
      body,
      headers: contentType ? { "Content-Type": contentType } : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network", "인터넷 연결을 확인해 주세요", 0);
  }
  if (res.ok) return (await res.json()) as T;
  let data: Partial<ApiErrorBody> = {};
  try {
    data = await res.json();
  } catch {
    // 프록시 오류 화면 등 JSON 이 아닐 수 있다
  }
  const retryAfter = Number(res.headers.get("retry-after") ?? 0) || 0;
  throw new ApiError(res.status, data.error ?? "server", data.message ?? "잠시 뒤에 다시 해 주세요", retryAfter);
}

const json = (data: unknown) => JSON.stringify(data);

export const api = {
  state: () => request<FaceState>("GET", "/state"),

  upload: (part: PartId, authorId: string | null, png: Blob) =>
    request<Drawing>(
      "POST",
      `/drawings?part=${part}${authorId ? `&author=${authorId}` : ""}`,
      png,
      "image/png",
    ),
  hideDrawing: (id: string) => request<Drawing>("DELETE", `/drawings/${id}`),
  restoreDrawing: (id: string) => request<Drawing>("POST", `/drawings/${id}/restore`),

  addAuthor: (input: AuthorInput) => request<Author>("POST", "/authors", json(input), "application/json"),
  updateAuthor: (id: string, input: Partial<AuthorInput>) =>
    request<Author>("PATCH", `/authors/${id}`, json(input), "application/json"),
  hideAuthor: (id: string) => request<Author>("DELETE", `/authors/${id}`),
  restoreAuthor: (id: string) => request<Author>("POST", `/authors/${id}/restore`),

  addAlbum: (input: AlbumInput) => request<AlbumEntry>("POST", "/album", json(input), "application/json"),
  renameAlbum: (id: string, name: string) =>
    request<AlbumEntry>("PATCH", `/album/${id}`, json({ name }), "application/json"),
  hideAlbum: (id: string) => request<AlbumEntry>("DELETE", `/album/${id}`),
  restoreAlbum: (id: string) => request<AlbumEntry>("POST", `/album/${id}/restore`),
};

export const drawingUrl = (id: string) => `${API}/drawings/${id}.png`;

/** 화면에 띄울 문구 */
export function friendlyError(error: unknown): string {
  if (!(error instanceof ApiError)) return "앗, 문제가 생겼어요. 다시 해 볼까요?";
  switch (error.code) {
    case "rate_limited":
      return error.retryAfterSec > 0
        ? `너무 빨라요! ${error.retryAfterSec}초 쉬었다가 다시 해요`
        : "너무 빨라요! 잠깐 쉬었다가 다시 해요";
    case "busy":
      return "다른 사람이 저장하는 중이에요. 다시 눌러 주세요";
    case "too_large":
      return "그림이 너무 커요. 조금 덜 칠해 볼까요?";
    case "network":
      return error.message;
    default:
      return error.message || "앗, 문제가 생겼어요. 다시 해 볼까요?";
  }
}
