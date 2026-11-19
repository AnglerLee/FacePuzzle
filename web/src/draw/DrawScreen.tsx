// 그리기 화면: 부위를 골라 확대된 캔버스에 그리고 [저장]하면 바로 다음 그림을 그릴 수 있다 (계속 추가).
// 짝 부위(눈·귀·눈썹): [양쪽 같이]는 한쪽만 크게 그리면 반대쪽이 거울로 붙는다.
//   [따로 그리기]는 눈·눈썹이면 두 쪽이 한 캔버스에 나와 한꺼번에 그리고, 귀는 왼쪽·오른쪽을 번갈아 그린다.
// 거울 붓 부위(얼굴·코·입·머리)는 거울 붓을 켜면 가운데 줄 기준으로 양쪽이 같이 그려진다.
import { LIMITS } from "@shared/limits";
import { getPart, imageBox, type PartId } from "@shared/parts";
import type { Drawing } from "@shared/types";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Screen } from "../app/App";
import { useData } from "../app/data";
import { FaceView } from "../face/FaceView";
import { activeDrawings, DEFAULT_FACE, resolveFace } from "../face/items";
import { ApiError, drawingUrl, friendlyError } from "../lib/api";
import { readPref, writePref } from "../lib/prefs";
import { buzz, sfx, unlockAudio } from "../lib/sound";
import { AuthorSheet } from "../ui/AuthorSheet";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/Toast";
import { DrawCanvas, type Side } from "./DrawCanvas";
import { inkPixels, MIN_INK, renderPart, toPngBlob, type Sides } from "./exportPng";
import {
  clearAll,
  emptyHistory,
  historyOf,
  mirrorStroke,
  pushStroke,
  redo,
  undo,
  type History,
  type Tool,
} from "./strokes";

export const CRAYONS = [
  "#2b2b2b", "#8b5a2b", "#f6c7a1", "#ef4444", "#fb923c", "#facc15",
  "#22c55e", "#38bdf8", "#3b5bdb", "#a855f7", "#f472b6", "#ffffff",
];
const SIZES = [7, 14, 26];
const SAVE_GAP_MS = 2000;

/** 기본 부위부터 */
const TAB_ORDER: PartId[] = ["eyes", "nose", "mouth", "face", "ears", "hair", "brows"];

/** 부위별 그리던 획: L 왼쪽(또는 전체), R 오른쪽(귀 따로), B 양쪽 한 캔버스(눈·눈썹 따로) */
interface Draft {
  L: History;
  R: History;
  B: History;
}
type Drafts = Partial<Record<PartId, Draft>>;

const emptyDraft = (): Draft => ({ L: emptyHistory(), R: emptyHistory(), B: emptyHistory() });
const draftOf = (drafts: Drafts, id: PartId) => drafts[id] ?? emptyDraft();
const isTogether = (id: PartId) => {
  const p = getPart(id);
  return p.symmetry === "pair" && p.pairEdit === "together";
};

/** 지금 그리는 방식으로 저장·미리보기에 쓸 획 */
function sidesOf(id: PartId, d: Draft, separate: boolean): Sides {
  if (getPart(id).symmetry !== "pair" || !separate) return { left: d.L.present, right: null };
  if (isTogether(id)) return { left: [], right: null, both: d.B.present };
  return { left: d.L.present, right: d.R.present };
}

function previewUrl(id: PartId, sides: Sides): string | null {
  const empty = sides.both
    ? sides.both.length === 0
    : sides.left.length === 0 && (!sides.right || sides.right.length === 0);
  if (empty) return null;
  return renderPart(getPart(id), sides).toDataURL("image/png");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function DrawScreen({ go }: { go: (s: Screen) => void }) {
  const { state, authors, authorById, upload, hideDrawing, restoreDrawing } = useData();
  const toast = useToast();
  const [partId, setPartId] = useState<PartId>(() => {
    const saved = readPref<string>("drawPart", "eyes");
    return (TAB_ORDER as string[]).includes(saved) ? (saved as PartId) : "eyes";
  });
  const [authorPref, setAuthorPref] = useState<string | null>(() => readPref<string | null>("author", null));
  const [color, setColor] = useState(CRAYONS[0]);
  const [sizeIdx, setSizeIdx] = useState(1);
  const [tool, setTool] = useState<Tool>("pen");
  const [mirrorMap, setMirrorMap] = useState<Partial<Record<PartId, boolean>>>({});
  const [separateMap, setSeparateMap] = useState<Partial<Record<PartId, boolean>>>({});
  const [side, setSide] = useState<Side>("L");
  const [drafts, setDrafts] = useState<Drafts>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [picked, setPicked] = useState<Drawing | null>(null);
  const [authorSheet, setAuthorSheet] = useState(false);
  const lastSave = useRef(0);

  const part = getPart(partId);
  const draft = draftOf(drafts, partId);
  const mirror = mirrorMap[partId] ?? part.mirrorDefault;
  const separate = part.symmetry === "pair" && (separateMap[partId] ?? false);
  const together = isTogether(partId);
  const activeSide: Side = !separate ? "L" : together ? "B" : side;
  const history = draft[activeSide];
  const authorId = authorPref && authors.some((a) => a.id === authorPref) ? authorPref : (authors[0]?.id ?? null);
  const list = useMemo(() => activeDrawings(state?.drawings ?? [], partId), [state, partId]);
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  // 기다리는 시간 표시
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const t = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= cooldownUntil) window.clearInterval(t);
    }, 500);
    return () => window.clearInterval(t);
  }, [cooldownUntil]);

  const separateFor = (id: PartId) => getPart(id).symmetry === "pair" && (separateMap[id] ?? false);

  function setDraftFor(id: PartId, next: Draft, sep = separateFor(id)) {
    setDrafts((d) => ({ ...d, [id]: next }));
    setPreview(previewUrl(id, sidesOf(id, next, sep)));
  }

  function changeHistory(fn: (h: History) => History) {
    const next = { ...draft, [activeSide]: fn(history) };
    setDraftFor(partId, next);
  }

  function pickPart(id: PartId) {
    unlockAudio();
    setPartId(id);
    writePref("drawPart", id);
    setSide("L");
    setPreview(previewUrl(id, sidesOf(id, draftOf(drafts, id), separateFor(id))));
  }

  function pickAuthor(id: string) {
    setAuthorPref(id);
    writePref("author", id);
  }

  /** [양쪽 같이] ↔ [따로 그리기] */
  function chooseSeparate(next: boolean) {
    if (next === separate) return;
    unlockAudio();
    setSeparateMap((m) => ({ ...m, [partId]: next }));
    let d = draft;
    // 한쪽만 그려 둔 게 있으면 두 쪽 캔버스에 양쪽으로 옮겨 이어 그리게 한다
    if (next && together && d.B.present.length === 0 && d.L.present.length > 0) {
      const w = imageBox(part).w;
      d = { ...d, B: historyOf([...d.L.present, ...d.L.present.map((s) => mirrorStroke(s, w))]) };
      setDrafts((all) => ({ ...all, [partId]: d }));
    }
    setSide(next && !together ? "R" : "L");
    setPreview(previewUrl(partId, sidesOf(partId, d, next)));
    sfx.pop();
  }

  async function save() {
    unlockAudio();
    if (saving || cooldown > 0 || Date.now() - lastSave.current < SAVE_GAP_MS) return;
    const canvas = renderPart(part, sidesOf(partId, draft, separate));
    if (inkPixels(canvas) < MIN_INK) {
      toast("아직 아무것도 안 그렸어요! ✏️");
      sfx.oops();
      return;
    }
    setSaving(true);
    lastSave.current = Date.now();
    try {
      const blob = await toPngBlob(canvas);
      let drawing: Drawing;
      try {
        drawing = await upload(partId, authorId, blob);
      } catch (error) {
        // 다른 업로드가 몰려 있으면 한 번만 잠깐 기다렸다 다시
        if (error instanceof ApiError && error.code === "busy") {
          await sleep(1500);
          drawing = await upload(partId, authorId, blob);
        } else throw error;
      }
      setDraftFor(partId, emptyDraft());
      setSide("L");
      setJustAdded(drawing.id);
      sfx.save();
      buzz(30);
      toast(`${part.label} 저장! 하나 더 그려 볼까요? ✨`, { tone: "success" });
    } catch (error) {
      if (error instanceof ApiError && error.code === "rate_limited" && error.retryAfterSec > 0) {
        setCooldownUntil(Date.now() + error.retryAfterSec * 1000);
        setNow(Date.now());
      }
      sfx.oops();
      toast(friendlyError(error), { tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function removePicked() {
    if (!picked) return;
    const target = picked;
    setPicked(null);
    try {
      await hideDrawing(target.id);
      toast("지웠어요", {
        action: {
          label: "되돌리기",
          onClick: () => {
            restoreDrawing(target.id).catch((error) => toast(friendlyError(error), { tone: "error" }));
          },
        },
      });
    } catch (error) {
      toast(friendlyError(error), { tone: "error" });
    }
  }

  const miniSrcs = { ...resolveFace(DEFAULT_FACE) };
  if (preview) miniSrcs[partId] = preview;
  else delete miniSrcs[partId];

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  return (
    <div className="screen draw-screen">
      <header className="topbar">
        <button type="button" className="nav-btn" onClick={() => go("slot")}>
          <span aria-hidden>🎰</span>슬롯
        </button>
        <h1 className="title">그리기</h1>
        <button type="button" className="nav-btn" onClick={() => go("album")}>
          <span aria-hidden>📒</span>앨범
        </button>
      </header>

      <nav className="part-tabs" aria-label="부위">
        {TAB_ORDER.map((id) => {
          const p = getPart(id);
          return (
            <button
              type="button"
              key={id}
              className={`part-tab ${id === partId ? "on" : ""}`}
              onClick={() => pickPart(id)}
              aria-pressed={id === partId}
            >
              <span aria-hidden>{p.emoji}</span>
              {p.label}
              {p.level === "advanced" && <small>심화</small>}
            </button>
          );
        })}
      </nav>

      <div className="draw-body">
        <section className="canvas-col">
          <div className="draw-options">
            {part.symmetry === "pair" ? (
              <>
                <div className="segmented small" role="radiogroup" aria-label="양쪽 그리기">
                  <button type="button" role="radio" aria-checked={!separate} className={!separate ? "on" : ""} onClick={() => chooseSeparate(false)}>
                    🪞 양쪽 같이
                  </button>
                  <button type="button" role="radio" aria-checked={separate} className={separate ? "on" : ""} onClick={() => chooseSeparate(true)}>
                    ✌️ 따로 그리기
                  </button>
                </div>
                {separate && !together && (
                  <div className="segmented small" role="radiogroup" aria-label="어느 쪽">
                    <button type="button" role="radio" aria-checked={side === "L"} className={side === "L" ? "on" : ""} onClick={() => setSide("L")}>
                      왼쪽
                    </button>
                    <button type="button" role="radio" aria-checked={side === "R"} className={side === "R" ? "on" : ""} onClick={() => setSide("R")}>
                      오른쪽
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`toggle ${mirror ? "on" : ""}`}
                  onClick={() => setMirrorMap((m) => ({ ...m, [partId]: !mirror }))}
                  aria-pressed={mirror}
                >
                  {mirror ? "🪞 거울 붓 켬" : "🪞 거울 붓 끔"}
                </button>
                <span className="option-note">{mirror ? "가운데 줄 기준으로 양쪽에 같이 그려져요" : "마음대로 그려요"}</span>
              </>
            )}
            {(() => {
              const a = authorId ? authorById.get(authorId) : undefined;
              return (
                <button
                  type="button"
                  className="author-chip current"
                  style={{ borderColor: a?.color, background: a?.color }}
                  onClick={() => setAuthorSheet(true)}
                  aria-label="그린 사람 고르기"
                >
                  <span aria-hidden>{a?.emoji ?? "🙂"}</span>
                  {a?.name ?? "누구?"} ▾
                </button>
              );
            })()}
          </div>

          <div className="canvas-area">
            <DrawCanvas
              part={part}
              side={activeSide}
              strokes={history.present}
              tool={tool}
              color={color}
              size={SIZES[sizeIdx]}
              mirror={mirror}
              onCommit={(s) => changeHistory((h) => pushStroke(h, s))}
            />
            <div className="mini-preview" aria-label="완성 얼굴 미리보기">
              <FaceView srcs={miniSrcs} dimOthers={partId} />
            </div>
          </div>
        </section>

        <section className="tool-col">
          <div className="crayons" role="radiogroup" aria-label="색">
            {CRAYONS.map((c) => (
              <button
                type="button"
                key={c}
                role="radio"
                aria-checked={tool === "pen" && color === c}
                aria-label={c}
                className={`crayon ${tool === "pen" && color === c ? "on" : ""}`}
                style={{ background: c }}
                onClick={() => {
                  setColor(c);
                  setTool("pen");
                }}
              />
            ))}
          </div>

          <div className="tools">
            <div className="sizes" role="radiogroup" aria-label="굵기">
              {SIZES.map((s, i) => (
                <button
                  type="button"
                  key={s}
                  role="radio"
                  aria-checked={sizeIdx === i}
                  aria-label={["가늘게", "보통", "굵게"][i]}
                  className={`size-btn ${sizeIdx === i ? "on" : ""}`}
                  onClick={() => setSizeIdx(i)}
                >
                  <span style={{ width: 6 + i * 6, height: 6 + i * 6, background: tool === "eraser" ? "#bbb" : color }} />
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`tool-btn ${tool === "eraser" ? "on" : ""}`}
              onClick={() => setTool(tool === "eraser" ? "pen" : "eraser")}
              aria-pressed={tool === "eraser"}
            >
              🧽<small>지우개</small>
            </button>
            <button type="button" className="tool-btn" onClick={() => changeHistory(undo)} disabled={!canUndo}>
              ↶<small>뒤로</small>
            </button>
            <button type="button" className="tool-btn hide-narrow" onClick={() => changeHistory(redo)} disabled={!canRedo}>
              ↷<small>앞으로</small>
            </button>
            <button type="button" className="tool-btn" onClick={() => changeHistory(clearAll)} disabled={history.present.length === 0}>
              🗑<small>다 지우기</small>
            </button>
            <button type="button" className="save-btn" onClick={save} disabled={saving || cooldown > 0}>
              {saving ? "저장 중…" : cooldown > 0 ? `⏳ ${cooldown}초 쉬어요` : `✔ ${part.label} 저장`}
            </button>
          </div>



          <div className="strip">
            <button
              type="button"
              className="strip-item add"
              onClick={() => {
                setDraftFor(partId, emptyDraft());
                setSide("L");
              }}
            >
              ➕<small>새 그림</small>
              <small className="strip-count">
                {list.length}/{LIMITS.perPartActive}
              </small>
            </button>
            {list.map((d) => {
              const author = d.authorId ? authorById.get(d.authorId) : undefined;
              return (
                <button
                  type="button"
                  key={d.id}
                  className={`strip-item ${d.id === justAdded ? "is-new" : ""}`}
                  style={{ borderColor: author?.color }}
                  onClick={() => setPicked(d)}
                >
                  <img src={drawingUrl(d.id)} alt={`${part.label} 그림`} loading="lazy" draggable={false} />
                  {author && <span className="strip-author">{author.emoji}</span>}
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {picked && (
        <Sheet title={`${part.label} 그림`} onClose={() => setPicked(null)}>
          <div className="picked">
            <div className="picked-img">
              <img src={drawingUrl(picked.id)} alt="" />
            </div>
            <p className="picked-meta">
              {picked.authorId && authorById.get(picked.authorId)
                ? `${authorById.get(picked.authorId)!.emoji} ${authorById.get(picked.authorId)!.name}`
                : "누군가"}
              {" · "}
              {new Date(picked.createdAt).toLocaleDateString("ko-KR")}
            </p>
            <div className="form-actions">
              <button type="button" className="ghost-btn danger" onClick={removePicked}>
                🗑 지우기
              </button>
              <button type="button" className="primary-btn" onClick={() => setPicked(null)}>
                닫기
              </button>
            </div>
          </div>
        </Sheet>
      )}
      {authorSheet && <AuthorSheet currentId={authorId} onClose={() => setAuthorSheet(false)} onPicked={pickAuthor} />}
    </div>
  );
}
