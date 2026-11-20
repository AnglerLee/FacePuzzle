// 서버 상태(작가·그림·앨범)를 들고 있는 컨텍스트. 바꾸는 요청은 돌아온 항목 하나만 목록에 반영한다.
// 화면이 다시 보일 때(다른 기기에서 그린 그림) 새로 받아 온다.
import type { PartId } from "@shared/parts";
import type { AlbumEntry, AlbumInput, Author, AuthorInput, BulkHideResult, Drawing, FaceState } from "@shared/types";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";

interface DataContextValue {
  state: FaceState | null;
  loadError: unknown;
  refresh: () => Promise<void>;
  authors: Author[];
  authorById: Map<string, Author>;
  upload: (part: PartId, authorId: string | null, png: Blob) => Promise<Drawing>;
  hideDrawing: (id: string) => Promise<void>;
  restoreDrawing: (id: string) => Promise<void>;
  /** 고른 부위 그림을 한꺼번에 숨긴다 (설정의 초기화) */
  hideParts: (parts: PartId[]) => Promise<BulkHideResult>;
  /** 한꺼번에 숨긴 그림을 그때 시각(hiddenAt)으로 한 번에 되살린다. 되살린 장 수 */
  restoreBatch: (hiddenAt: string) => Promise<number>;
  addAuthor: (input: AuthorInput) => Promise<Author>;
  updateAuthor: (id: string, input: Partial<AuthorInput>) => Promise<void>;
  hideAuthor: (id: string) => Promise<void>;
  restoreAuthor: (id: string) => Promise<void>;
  addAlbum: (input: AlbumInput) => Promise<AlbumEntry>;
  renameAlbum: (id: string, name: string) => Promise<void>;
  hideAlbum: (id: string) => Promise<void>;
  restoreAlbum: (id: string) => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("DataProvider 밖에서 useData 를 불렀어요");
  return ctx;
}

type ListKey = "drawings" | "authors" | "album";

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const next = [...list];
  next[i] = item;
  return next;
}

const REFRESH_GAP_MS = 4000;

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FaceState | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const lastRefresh = useRef(0);

  const refresh = useCallback((): Promise<void> => {
    lastRefresh.current = Date.now();
    return api.state().then(
      (next) => {
        setState(next);
        setLoadError(null);
      },
      (error: unknown) => setLoadError(error),
    );
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefresh.current > REFRESH_GAP_MS) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  const patch = useCallback(<K extends ListKey>(key: K, item: FaceState[K][number]) => {
    setState((s) => (s ? { ...s, [key]: upsert(s[key] as { id: string }[], item as { id: string }) } : s));
  }, []);

  const patchDrawings = useCallback((items: Drawing[]) => {
    const byId = new Map(items.map((d) => [d.id, d]));
    setState((s) => (s ? { ...s, drawings: s.drawings.map((d) => byId.get(d.id) ?? d) } : s));
  }, []);

  const value = useMemo<DataContextValue>(() => {
    const authors = (state?.authors ?? []).filter((a) => !a.hiddenAt);
    return {
      state,
      loadError,
      refresh,
      authors,
      authorById: new Map((state?.authors ?? []).map((a) => [a.id, a])),
      upload: async (part, authorId, png) => {
        const d = await api.upload(part, authorId, png);
        patch("drawings", d);
        return d;
      },
      hideDrawing: async (id) => patch("drawings", await api.hideDrawing(id)),
      restoreDrawing: async (id) => patch("drawings", await api.restoreDrawing(id)),
      hideParts: async (parts) => {
        const result = await api.hideDrawingsOfParts(parts);
        patchDrawings(result.drawings);
        return result;
      },
      restoreBatch: async (hiddenAt) => {
        const back = await api.restoreDrawingsHiddenAt(hiddenAt);
        patchDrawings(back);
        return back.length;
      },
      addAuthor: async (input) => {
        const a = await api.addAuthor(input);
        patch("authors", a);
        return a;
      },
      updateAuthor: async (id, input) => patch("authors", await api.updateAuthor(id, input)),
      hideAuthor: async (id) => patch("authors", await api.hideAuthor(id)),
      restoreAuthor: async (id) => patch("authors", await api.restoreAuthor(id)),
      addAlbum: async (input) => {
        const e = await api.addAlbum(input);
        patch("album", e);
        return e;
      },
      renameAlbum: async (id, name) => patch("album", await api.renameAlbum(id, name)),
      hideAlbum: async (id) => patch("album", await api.hideAlbum(id)),
      restoreAlbum: async (id) => patch("album", await api.restoreAlbum(id)),
    };
  }, [state, loadError, refresh, patch, patchDrawings]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
