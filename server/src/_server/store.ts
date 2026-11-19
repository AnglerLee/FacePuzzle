// 그림·작가·앨범 저장소.
// 데이터: $DATA_DIR/facepuzzle/index.json (목록 하나) + $DATA_DIR/facepuzzle/drawings/<id>.png
// 모든 쓰기는 in-process 락으로 한 줄로 세우고 writeFileAtomic 으로 쓴다 (english-buddy family-store 방식).
// 지우기는 숨김(hiddenAt)이고, 숨긴 지 trashDays 가 지나면 정리한다. 단, 보이는 앨범이 쓰는 그림은 남긴다.
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { LIMITS } from "@shared/limits";
import { getPart, imageBox, isPartId, type PartId } from "@shared/parts";
import {
  DEFAULT_AUTHORS,
  isId,
  isPartRef,
  type AlbumEntry,
  type AlbumInput,
  type Author,
  type AuthorInput,
  type Drawing,
  type FaceState,
} from "@shared/types";
import { dataDir, writeFileAtomic } from "../lib/json-file";
import { HttpError } from "./guard";

const APP = "facepuzzle";
const GC_INTERVAL_MS = 60 * 60_000;
const TRASH_MS = LIMITS.trashDays * 86_400_000;

interface IndexDoc extends FaceState {
  version: 1;
  lastGc?: number;
}

const indexFile = () => dataDir(APP, "index.json");
export const drawingFile = (id: string) => dataDir(APP, "drawings", `${id}.png`);

/** 동시 쓰기 직렬화용 in-process 락 */
let writeChain: Promise<unknown> = Promise.resolve();
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run;
}

function newId(taken: (id: string) => boolean): string {
  for (;;) {
    const id = randomBytes(8).toString("hex");
    if (!taken(id)) return id;
  }
}

const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

// ── 읽기: 파일 내용을 믿지 않고 항목마다 확인한다 ──
function normalizeDrawing(v: unknown): Drawing | null {
  const d = v as Partial<Drawing> | null;
  if (!d || !isId(d.id) || !isPartId(d.part) || !isIso(d.createdAt)) return null;
  if (!Number.isInteger(d.bytes) || (d.bytes as number) < 0) return null;
  return {
    id: d.id,
    part: d.part,
    authorId: isId(d.authorId) ? d.authorId : null,
    createdAt: d.createdAt,
    bytes: d.bytes as number,
    ...(isIso(d.hiddenAt) ? { hiddenAt: d.hiddenAt } : {}),
  };
}

function normalizeAuthor(v: unknown): Author | null {
  const a = v as Partial<Author> | null;
  if (!a || !isId(a.id) || typeof a.name !== "string" || typeof a.emoji !== "string" || typeof a.color !== "string") return null;
  if (!isIso(a.createdAt)) return null;
  return {
    id: a.id,
    name: a.name,
    emoji: a.emoji,
    color: a.color,
    createdAt: a.createdAt,
    ...(isIso(a.hiddenAt) ? { hiddenAt: a.hiddenAt } : {}),
  };
}

function normalizeAlbum(v: unknown): AlbumEntry | null {
  const e = v as Partial<AlbumEntry> | null;
  if (!e || !isId(e.id) || typeof e.name !== "string" || !isIso(e.createdAt)) return null;
  if (!e.parts || typeof e.parts !== "object") return null;
  const parts: AlbumEntry["parts"] = {};
  for (const [k, ref] of Object.entries(e.parts)) if (isPartId(k) && isPartRef(ref)) parts[k] = ref;
  return {
    id: e.id,
    name: e.name,
    parts,
    createdAt: e.createdAt,
    ...(isIso(e.hiddenAt) ? { hiddenAt: e.hiddenAt } : {}),
  };
}

function compact<T>(list: unknown, fn: (v: unknown) => T | null): T[] {
  return Array.isArray(list) ? list.map(fn).filter((v): v is T => v !== null) : [];
}

function seedDoc(now: Date): IndexDoc {
  const taken = new Set<string>();
  const authors = DEFAULT_AUTHORS.map((a) => {
    const id = newId((x) => taken.has(x));
    taken.add(id);
    return { id, ...a, createdAt: now.toISOString() };
  });
  return { version: 1, rev: 0, drawings: [], authors, album: [], lastGc: now.getTime() };
}

async function readDoc(): Promise<IndexDoc | null> {
  let raw: string;
  try {
    raw = await fs.readFile(indexFile(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const parsed = JSON.parse(raw) as Partial<IndexDoc>;
  return {
    version: 1,
    rev: Number.isInteger(parsed.rev) ? (parsed.rev as number) : 0,
    drawings: compact(parsed.drawings, normalizeDrawing),
    authors: compact(parsed.authors, normalizeAuthor),
    album: compact(parsed.album, normalizeAlbum),
    lastGc: typeof parsed.lastGc === "number" ? parsed.lastGc : 0,
  };
}

async function saveDoc(doc: IndexDoc): Promise<void> {
  doc.rev += 1;
  await writeFileAtomic(indexFile(), JSON.stringify(doc));
}

/** 락 안에서만 부른다. 처음이면 기본 작가를 넣어 바로 저장한다 (작가 id 가 읽을 때마다 바뀌지 않게) */
async function loadForWrite(now: Date): Promise<IndexDoc> {
  const doc = await readDoc();
  if (doc) return doc;
  const seeded = seedDoc(now);
  await saveDoc(seeded);
  return seeded;
}

/** 숨긴 지 오래된 항목 정리. 보이는 앨범이 쓰는 그림은 남긴다 */
async function collectGarbage(doc: IndexDoc, now: Date): Promise<boolean> {
  const cutoff = now.getTime() - TRASH_MS;
  const expired = (item: { hiddenAt?: string }) => !!item.hiddenAt && Date.parse(item.hiddenAt) < cutoff;
  const usedByAlbum = new Set(doc.album.filter((e) => !expired(e)).flatMap((e) => Object.values(e.parts)));

  const before = doc.drawings.length + doc.authors.length + doc.album.length;
  const dropDrawings = doc.drawings.filter((d) => expired(d) && !usedByAlbum.has(d.id));
  const dropIds = new Set(dropDrawings.map((d) => d.id));
  doc.drawings = doc.drawings.filter((d) => !dropIds.has(d.id));
  const goneAuthors = new Set(doc.authors.filter(expired).map((a) => a.id));
  doc.authors = doc.authors.filter((a) => !goneAuthors.has(a.id));
  for (const d of doc.drawings) if (d.authorId && goneAuthors.has(d.authorId)) d.authorId = null;
  doc.album = doc.album.filter((e) => !expired(e));
  doc.lastGc = now.getTime();

  for (const d of dropDrawings) await fs.rm(drawingFile(d.id), { force: true }).catch(() => undefined);
  return doc.drawings.length + doc.authors.length + doc.album.length !== before;
}

/** 쓰기 한 번: 락 → 읽기 → (때가 되면 정리) → 바꾸기 → 저장 */
function mutate<T>(now: Date, fn: (doc: IndexDoc) => Promise<T> | T): Promise<T> {
  return withWriteLock(async () => {
    const doc = await loadForWrite(now);
    if (now.getTime() - (doc.lastGc ?? 0) > GC_INTERVAL_MS) await collectGarbage(doc, now);
    const result = await fn(doc);
    await saveDoc(doc);
    return result;
  });
}

function toState(doc: IndexDoc): FaceState {
  return { rev: doc.rev, drawings: doc.drawings, authors: doc.authors, album: doc.album };
}

export async function getState(now = new Date()): Promise<FaceState> {
  const doc = await readDoc();
  if (doc && now.getTime() - (doc.lastGc ?? 0) <= GC_INTERVAL_MS) return toState(doc);
  // 처음이거나 정리할 때가 되었으면 락 안에서 만들고/정리한다
  return withWriteLock(async () => {
    const fresh = await loadForWrite(now);
    if (now.getTime() - (fresh.lastGc ?? 0) > GC_INTERVAL_MS) {
      await collectGarbage(fresh, now);
      await saveDoc(fresh);
    }
    return toState(fresh);
  });
}

const notFound = (what: string) => new HttpError(404, "not_found", `${what}을(를) 찾지 못했어요`);
const full = (message: string) => new HttpError(409, "full", message);

function find<T extends { id: string }>(list: T[], id: string, what: string): T {
  const item = list.find((x) => x.id === id);
  if (!item) throw notFound(what);
  return item;
}

function assertPartRoom(doc: IndexDoc, part: PartId): void {
  const active = doc.drawings.filter((d) => d.part === part && !d.hiddenAt).length;
  if (active >= LIMITS.perPartActive) {
    throw full(`${getPart(part).label} 그림이 꽉 찼어요 (${LIMITS.perPartActive}장). 안 쓰는 그림을 지워 주세요`);
  }
}

// ── 그림 ──
export function expectedSize(part: PartId): { width: number; height: number } {
  const box = imageBox(getPart(part));
  return { width: box.w, height: box.h };
}

export function addDrawing(png: Uint8Array, part: PartId, authorId: string | null, now = new Date()): Promise<Drawing> {
  let written: string | null = null;
  return mutate(now, async (doc) => {
    if (authorId && !doc.authors.some((a) => a.id === authorId)) {
      throw new HttpError(400, "bad_request", "그린 사람을 찾지 못했어요");
    }
    assertPartRoom(doc, part);
    if (doc.drawings.length >= LIMITS.totalDrawingFiles) {
      throw full("그림 보관함이 꽉 찼어요. 휴지통을 비우거나 안 쓰는 그림을 지워 주세요");
    }
    const used = doc.drawings.reduce((sum, d) => sum + d.bytes, 0);
    if (used + png.byteLength > LIMITS.totalBytes) {
      throw full("그림 보관함 용량이 꽉 찼어요. 안 쓰는 그림을 지워 주세요");
    }
    const taken = new Set(doc.drawings.map((d) => d.id));
    const drawing: Drawing = {
      id: newId((id) => taken.has(id)),
      part,
      authorId,
      createdAt: now.toISOString(),
      bytes: png.byteLength,
    };
    await writeFileAtomic(drawingFile(drawing.id), png);
    written = drawing.id;
    doc.drawings.push(drawing);
    return drawing;
  }).catch(async (error) => {
    // 목록 저장이 실패하면 방금 쓴 PNG 를 지워 고아 파일을 남기지 않는다
    if (written) await fs.rm(drawingFile(written), { force: true }).catch(() => undefined);
    throw error;
  });
}

export function hideDrawing(id: string, now = new Date()): Promise<Drawing> {
  return mutate(now, (doc) => {
    const d = find(doc.drawings, id, "그림");
    if (!d.hiddenAt) d.hiddenAt = now.toISOString();
    return d;
  });
}

export function restoreDrawing(id: string, now = new Date()): Promise<Drawing> {
  return mutate(now, (doc) => {
    const d = find(doc.drawings, id, "그림");
    if (d.hiddenAt) {
      assertPartRoom(doc, d.part);
      delete d.hiddenAt;
    }
    return d;
  });
}

export async function readDrawing(id: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(drawingFile(id));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// ── 작가 ──
export function addAuthor(input: AuthorInput, now = new Date()): Promise<Author> {
  return mutate(now, (doc) => {
    if (doc.authors.length >= LIMITS.authorsMax) {
      throw full(`그린 사람은 ${LIMITS.authorsMax}명까지예요. 휴지통에 있는 사람도 세요`);
    }
    const taken = new Set(doc.authors.map((a) => a.id));
    const author: Author = { id: newId((id) => taken.has(id)), ...input, createdAt: now.toISOString() };
    doc.authors.push(author);
    return author;
  });
}

export function updateAuthor(id: string, input: Partial<AuthorInput>, now = new Date()): Promise<Author> {
  return mutate(now, (doc) => {
    const a = find(doc.authors, id, "그린 사람");
    Object.assign(a, input);
    return a;
  });
}

export function hideAuthor(id: string, now = new Date()): Promise<Author> {
  return mutate(now, (doc) => {
    const a = find(doc.authors, id, "그린 사람");
    if (!a.hiddenAt) {
      const others = doc.authors.filter((x) => x.id !== id && !x.hiddenAt).length;
      if (others === 0) throw new HttpError(400, "bad_request", "그린 사람이 한 명은 있어야 해요");
      a.hiddenAt = now.toISOString();
    }
    return a;
  });
}

export function restoreAuthor(id: string, now = new Date()): Promise<Author> {
  return mutate(now, (doc) => {
    const a = find(doc.authors, id, "그린 사람");
    delete a.hiddenAt;
    return a;
  });
}

// ── 앨범 ──
export function addAlbum(input: AlbumInput, now = new Date()): Promise<AlbumEntry> {
  return mutate(now, (doc) => {
    if (doc.album.length >= LIMITS.albumMax) {
      throw full(`앨범이 꽉 찼어요 (${LIMITS.albumMax}개). 안 보는 얼굴을 지워 주세요`);
    }
    const known = new Set(doc.drawings.map((d) => d.id));
    for (const [part, ref] of Object.entries(input.parts)) {
      if (ref.startsWith("sample-")) continue;
      const d = doc.drawings.find((x) => x.id === ref);
      if (!known.has(ref) || d?.part !== part) throw new HttpError(400, "bad_request", "없는 그림이 들어 있어요");
    }
    const taken = new Set(doc.album.map((e) => e.id));
    const entry: AlbumEntry = { id: newId((id) => taken.has(id)), ...input, createdAt: now.toISOString() };
    doc.album.push(entry);
    return entry;
  });
}

export function renameAlbum(id: string, name: string, now = new Date()): Promise<AlbumEntry> {
  return mutate(now, (doc) => {
    const e = find(doc.album, id, "앨범 얼굴");
    e.name = name;
    return e;
  });
}

export function hideAlbum(id: string, now = new Date()): Promise<AlbumEntry> {
  return mutate(now, (doc) => {
    const e = find(doc.album, id, "앨범 얼굴");
    if (!e.hiddenAt) e.hiddenAt = now.toISOString();
    return e;
  });
}

export function restoreAlbum(id: string, now = new Date()): Promise<AlbumEntry> {
  return mutate(now, (doc) => {
    const e = find(doc.album, id, "앨범 얼굴");
    delete e.hiddenAt;
    return e;
  });
}

/** 테스트용: 락 체인을 비운다 */
export function resetStoreForTests(): void {
  writeChain = Promise.resolve();
}
