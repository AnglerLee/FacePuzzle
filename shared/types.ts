// 서버 저장 형식과 API 응답 타입, 입력 검증. 화면과 서버가 같이 쓴다.
import { LIMITS } from "./limits";
import { isPartId, PARTS, type PartId } from "./parts";

export interface Drawing {
  id: string;
  part: PartId;
  authorId: string | null;
  createdAt: string;
  bytes: number;
  hiddenAt?: string;
}

export interface Author {
  id: string;
  name: string;
  emoji: string;
  color: string;
  createdAt: string;
  hiddenAt?: string;
}

/** 부위별 그림 참조: 그림 id(16자리 hex) 또는 기본 예시 그림 "sample-<번호>" */
export type PartRef = string;

export interface AlbumEntry {
  id: string;
  name: string;
  parts: Partial<Record<PartId, PartRef>>;
  createdAt: string;
  hiddenAt?: string;
}

export interface FaceState {
  rev: number;
  drawings: Drawing[];
  authors: Author[];
  album: AlbumEntry[];
}

export type ApiErrorCode =
  | "bad_request"
  | "forbidden"
  | "not_found"
  | "too_large"
  | "timeout"
  | "rate_limited"
  | "busy"
  | "full";

export interface ApiErrorBody {
  error: ApiErrorCode;
  message: string;
}

export const ID_PATTERN = /^[0-9a-f]{16}$/;
export const SAMPLE_PATTERN = /^sample-(\d{1,2})$/;

export function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function isPartRef(value: unknown): value is PartRef {
  return typeof value === "string" && (ID_PATTERN.test(value) || SAMPLE_PATTERN.test(value));
}

export const AUTHOR_COLORS = [
  "#ff6b8b",
  "#ff9f1c",
  "#ffd23f",
  "#3ecf8e",
  "#3a86ff",
  "#8b5cf6",
  "#14b8a6",
  "#a16207",
] as const;

export const AUTHOR_EMOJIS = [
  "🧒", "👧", "👦", "👶", "👩", "👨", "👵", "👴",
  "🐱", "🐶", "🐰", "🐻", "🦊", "🐼", "🦁", "🐸",
] as const;

export const DEFAULT_AUTHORS: ReadonlyArray<Pick<Author, "name" | "emoji" | "color">> = [
  { name: "나", emoji: "🧒", color: "#ff6b8b" },
  { name: "엄마", emoji: "👩", color: "#ff9f1c" },
  { name: "아빠", emoji: "👨", color: "#3a86ff" },
];

// 제어문자, 폭 없는 문자(ZWSP·ZWJ 제외 이모지 결합은 이름에 필요 없다), 방향 제어문자
// eslint-disable-next-line no-control-regex
const STRIP = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g;

/** 이름 같은 짧은 글: NFC 정규화, 제어·보이지 않는 문자 제거, 공백 정리, 길이 자르기. 비면 null */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFC").replace(STRIP, "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return [...text].slice(0, max).join("");
}

export interface AuthorInput {
  name: string;
  emoji: string;
  color: string;
}

/** 작가 입력 검증. 일부만 바꿀 때(partial)는 들어온 필드만 검사한다 */
export function parseAuthorInput(body: unknown, partial = false): Partial<AuthorInput> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const out: Partial<AuthorInput> = {};
  if (b.name !== undefined || !partial) {
    const name = cleanText(b.name, LIMITS.authorNameMax);
    if (!name) return null;
    out.name = name;
  }
  if (b.emoji !== undefined || !partial) {
    if (!(AUTHOR_EMOJIS as readonly unknown[]).includes(b.emoji)) return null;
    out.emoji = b.emoji as string;
  }
  if (b.color !== undefined || !partial) {
    if (!(AUTHOR_COLORS as readonly unknown[]).includes(b.color)) return null;
    out.color = b.color as string;
  }
  if (partial && Object.keys(out).length === 0) return null;
  return out;
}

export interface AlbumInput {
  name: string;
  parts: Partial<Record<PartId, PartRef>>;
}

export function parseAlbumInput(body: unknown): AlbumInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const name = cleanText(b.name, LIMITS.albumNameMax);
  if (!name) return null;
  if (!b.parts || typeof b.parts !== "object" || Array.isArray(b.parts)) return null;
  const parts: Partial<Record<PartId, PartRef>> = {};
  const entries = Object.entries(b.parts as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 10) return null;
  for (const [key, ref] of entries) {
    if (!isPartId(key) || !isPartRef(ref)) return null;
    parts[key] = ref;
  }
  return { name, parts };
}

/** 한꺼번에 지우기(설정의 [그린 그림 초기화]): 고른 부위의 보이는 그림을 모두 숨긴다 */
export interface BulkHideInput {
  parts: PartId[];
}

/** 한꺼번에 지운 그림은 모두 같은 hiddenAt 을 받는다. 그 값으로 한 번에 되살린다 */
export interface BulkHideResult {
  hiddenAt: string;
  drawings: Drawing[];
}

export function parseBulkHideInput(body: unknown): BulkHideInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const list = (body as Record<string, unknown>).parts;
  if (!Array.isArray(list) || list.length === 0 || list.length > PARTS.length) return null;
  if (!list.every(isPartId)) return null;
  return { parts: [...new Set(list)] };
}

export function parseBulkRestoreInput(body: unknown): { hiddenAt: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const at = (body as Record<string, unknown>).hiddenAt;
  if (typeof at !== "string" || at.length > 32 || Number.isNaN(Date.parse(at))) return null;
  return { hiddenAt: at };
}
