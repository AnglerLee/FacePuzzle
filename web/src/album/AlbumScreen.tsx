// 앨범: 슬롯에서 담은 얼굴 모음. 크게 보기·이름 바꾸기·이미지 저장/공유·지우기, 휴지통(30일 안에 되살리기).
import { LIMITS } from "@shared/limits";
import { getPart } from "@shared/parts";
import type { AlbumEntry } from "@shared/types";
import { useMemo, useState } from "react";
import type { Screen } from "../app/App";
import { useData } from "../app/data";
import { FaceView } from "../face/FaceView";
import { resolveFace } from "../face/items";
import { drawingUrl, friendlyError } from "../lib/api";
import { sfx } from "../lib/sound";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/Toast";
import { composeFace, shareOrDownload } from "./compose";

const newestFirst = <T extends { createdAt: string }>(a: T, b: T) => (a.createdAt < b.createdAt ? 1 : -1);
const hiddenFirst = <T extends { hiddenAt?: string }>(a: T, b: T) => ((a.hiddenAt ?? "") < (b.hiddenAt ?? "") ? 1 : -1);

function daysLeft(hiddenAt: string): number {
  const gone = Date.parse(hiddenAt) + LIMITS.trashDays * 86_400_000;
  return Math.max(0, Math.ceil((gone - Date.now()) / 86_400_000));
}

export function AlbumScreen({ go }: { go: (s: Screen) => void }) {
  const { state, renameAlbum, hideAlbum, restoreAlbum, restoreDrawing, restoreAuthor } = useData();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [trash, setTrash] = useState(false);
  const [exporting, setExporting] = useState(false);

  const entries = useMemo(() => (state?.album ?? []).filter((e) => !e.hiddenAt).sort(newestFirst), [state]);
  const open = entries.find((e) => e.id === openId) ?? null;

  function openEntry(e: AlbumEntry) {
    setOpenId(e.id);
    setNameDraft(e.name);
  }

  async function commitName() {
    if (!open) return;
    const name = nameDraft.trim();
    if (!name || name === open.name) return;
    try {
      await renameAlbum(open.id, name);
    } catch (error) {
      toast(friendlyError(error), { tone: "error" });
      setNameDraft(open.name);
    }
  }

  async function exportOpen() {
    if (!open || exporting) return;
    setExporting(true);
    try {
      const blob = await composeFace(resolveFace(open.parts), nameDraft.trim() || open.name);
      const how = await shareOrDownload(blob, nameDraft.trim() || open.name);
      if (how === "downloaded") toast("이미지를 저장했어요 🖼️", { tone: "success" });
    } catch (error) {
      toast(error instanceof Error ? error.message : "이미지를 만들지 못했어요", { tone: "error" });
    } finally {
      setExporting(false);
    }
  }

  async function removeOpen() {
    if (!open) return;
    const target = open;
    setOpenId(null);
    try {
      await hideAlbum(target.id);
      sfx.pop();
      toast("휴지통으로 옮겼어요", {
        action: { label: "되돌리기", onClick: () => void restoreAlbum(target.id).catch((e) => toast(friendlyError(e), { tone: "error" })) },
      });
    } catch (error) {
      toast(friendlyError(error), { tone: "error" });
    }
  }

  async function restore(fn: () => Promise<void>) {
    try {
      await fn();
      sfx.save();
      toast("되살렸어요 ✨", { tone: "success" });
    } catch (error) {
      toast(friendlyError(error), { tone: "error" });
    }
  }

  const trashDrawings = (state?.drawings ?? []).filter((d) => d.hiddenAt).sort(hiddenFirst);
  const trashAlbum = (state?.album ?? []).filter((e) => e.hiddenAt).sort(hiddenFirst);
  const trashAuthors = (state?.authors ?? []).filter((a) => a.hiddenAt);
  const trashCount = trashDrawings.length + trashAlbum.length + trashAuthors.length;

  return (
    <div className="screen album-screen">
      <header className="topbar">
        <button type="button" className="nav-btn" onClick={() => go("slot")}>
          <span aria-hidden>🎰</span>슬롯
        </button>
        <h1 className="title">얼굴 앨범</h1>
        <button type="button" className="nav-btn" onClick={() => setTrash(true)}>
          <span aria-hidden>🗑</span>휴지통{trashCount > 0 ? ` ${trashCount}` : ""}
        </button>
      </header>

      {entries.length === 0 ? (
        <div className="empty">
          <p className="empty-face" aria-hidden>
            🤪
          </p>
          <p>아직 담은 얼굴이 없어요.</p>
          <p>슬롯을 돌리고 [📒 앨범에 담기]를 눌러 보세요!</p>
          <button type="button" className="primary-btn" onClick={() => go("slot")}>
            🎰 슬롯 돌리러 가기
          </button>
        </div>
      ) : (
        <div className="album-grid">
          {entries.map((e) => (
            <button type="button" key={e.id} className="album-card" onClick={() => openEntry(e)}>
              <FaceView srcs={resolveFace(e.parts)} className="card-face" />
              <span className="card-name">{e.name}</span>
            </button>
          ))}
        </div>
      )}

      {open && (
        <Sheet title="완성 얼굴" onClose={() => setOpenId(null)}>
          <div className="album-detail">
            <FaceView srcs={resolveFace(open.parts)} className="detail-face" />
            <label className="field">
              <span>이름</span>
              <input
                value={nameDraft}
                maxLength={LIMITS.albumNameMax}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
            </label>
            <p className="picked-meta">{new Date(open.createdAt).toLocaleString("ko-KR")}</p>
            <div className="form-actions">
              <button type="button" className="ghost-btn danger" onClick={removeOpen}>
                🗑 지우기
              </button>
              <button type="button" className="primary-btn" onClick={exportOpen} disabled={exporting}>
                {exporting ? "만드는 중…" : "📤 이미지 저장·공유"}
              </button>
            </div>
          </div>
        </Sheet>
      )}

      {trash && (
        <Sheet title="휴지통" onClose={() => setTrash(false)}>
          <p className="trash-note">지운 것은 {LIMITS.trashDays}일 동안 여기 있다가 정말로 사라져요.</p>
          {trashCount === 0 && <p className="trash-empty">비어 있어요 ✨</p>}
          {trashDrawings.length > 0 && (
            <>
              <h3 className="trash-title">그림</h3>
              <div className="trash-grid">
                {trashDrawings.map((d) => (
                  <div key={d.id} className="trash-item">
                    <div className="trash-thumb">
                      <img src={drawingUrl(d.id)} alt="" loading="lazy" />
                    </div>
                    <small>
                      {getPart(d.part).label} · {daysLeft(d.hiddenAt!)}일 남음
                    </small>
                    <button type="button" className="mini-btn" onClick={() => restore(() => restoreDrawing(d.id))}>
                      되살리기
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {trashAlbum.length > 0 && (
            <>
              <h3 className="trash-title">앨범 얼굴</h3>
              <div className="trash-grid">
                {trashAlbum.map((e) => (
                  <div key={e.id} className="trash-item">
                    <FaceView srcs={resolveFace(e.parts)} className="trash-face" />
                    <small>
                      {e.name} · {daysLeft(e.hiddenAt!)}일 남음
                    </small>
                    <button type="button" className="mini-btn" onClick={() => restore(() => restoreAlbum(e.id))}>
                      되살리기
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {trashAuthors.length > 0 && (
            <>
              <h3 className="trash-title">그린 사람</h3>
              <div className="author-list">
                {trashAuthors.map((a) => (
                  <button type="button" key={a.id} className="author-chip" style={{ borderColor: a.color }} onClick={() => restore(() => restoreAuthor(a.id))}>
                    {a.emoji} {a.name} · 되살리기
                  </button>
                ))}
              </div>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
