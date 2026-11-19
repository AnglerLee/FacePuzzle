// 그리기 화면: 부위를 골라 확대된 캔버스에 그리고 [저장]하면 바로 다음 그림을 그릴 수 있다 (계속 추가).
// 모든 부위에 [🪞 거울 모드] / [✏️ 일반 모드]가 있다.
// - 짝 부위(눈·귀·눈썹): 거울 모드는 한쪽만 크게 그리면 반대쪽이 거울로 똑같이 붙는다.
//   일반 모드는 눈·눈썹이면 두 쪽이 한 캔버스에 나와 마음대로 그리고, 귀는 왼쪽·오른쪽을 번갈아 그린다.
// - 나머지(얼굴·코·입·머리): 거울 모드는 가운데 줄 기준으로 양쪽이 같이 그려진다.
import { activeParts, getPart, imageBox, type Level, type PartId } from "@shared/parts";
import type { Drawing, PartRef } from "@shared/types";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Screen } from "../app/App";
import { useData } from "../app/data";
import { FaceView } from "../face/FaceView";
import { activeDrawings, candidates, DEFAULT_FACE, resolveFace } from "../face/items";
import { ApiError, drawingUrl, friendlyError } from "../lib/api";
import { dragScroll } from "../lib/dragScroll";
import { readPref, writePref } from "../lib/prefs";
import { buzz, sfx, unlockAudio } from "../lib/sound";
import { speak } from "../lib/speech";
import { AuthorSheet } from "../ui/AuthorSheet";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/Toast";
import { ColorSheet } from "./ColorSheet";
import { CRAYONS, MAIN_CRAYONS, MORE_CRAYONS } from "./colors";
import { DrawCanvas, type Side } from "./DrawCanvas";
import { inkPixels, MIN_INK, renderPart, toPngBlob, type Sides } from "./exportPng";
import {
  clearAll,
  emptyHistory,
  historyOf,
  mirrorStroke,
  pushStroke,
  undo,
  type History,
  type Tool,
} from "./strokes";

const SIZES = [7, 14, 26];
const SAVE_GAP_MS = 2000;

/** 기본 부위부터. 기본 단계에서는 눈·코·입 탭만 보인다 (슬롯 설정의 단계를 따른다) */
const TAB_ORDER: PartId[] = ["eyes", "nose", "mouth", "face", "ears", "hair", "brows"];
const tabsFor = (level: Level) => TAB_ORDER.filter((id) => level === "advanced" || getPart(id).level === "basic");

/** 캔버스 위 안내·읽어주기 문구 */
function hintFor(id: PartId, mirrorMode: boolean, side: Side): string {
  const p = getPart(id);
  if (p.symmetry !== "pair" || mirrorMode) return p.hint;
  if (side === "B") return p.hintBoth ?? p.hint;
  return p.hint.replace("한쪽", side === "R" ? "오른쪽" : "왼쪽");
}
const MODE_SAY = {
  mirror: "거울 모드! 한쪽만 그리면 반대쪽도 똑같이 생겨요",
  free: "일반 모드! 마음대로 그려요",
};

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
  const [level] = useState<Level>(() => (readPref<string>("level", "basic") === "advanced" ? "advanced" : "basic"));
  const tabs = useMemo(() => tabsFor(level), [level]);
  const [partId, setPartId] = useState<PartId>(() => {
    const saved = readPref<string>("drawPart", "eyes");
    return (tabs as string[]).includes(saved) ? (saved as PartId) : "eyes";
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
  const [palette, setPalette] = useState(false);
  /** 얼굴 전체로 보기 창, 그때 다른 부위에 대 볼 그림들 (비면 기본 얼굴) */
  const [faceCheck, setFaceCheck] = useState(false);
  const [faceMix, setFaceMix] = useState<Partial<Record<PartId, PartRef>>>({});
  const lastSave = useRef(0);
  const [drag] = useState(dragScroll);

  const part = getPart(partId);
  const draft = draftOf(drafts, partId);
  const mirror = mirrorMap[partId] ?? part.mirrorDefault;
  const separate = part.symmetry === "pair" && (separateMap[partId] ?? false);
  const together = isTogether(partId);
  const mirrorMode = part.symmetry === "pair" ? !separate : mirror;
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

  /** 거울 모드인지: 짝 부위는 한쪽만 그릴 때, 나머지는 거울 붓이 켜졌을 때 */
  const mirrorModeOf = (id: PartId) =>
    getPart(id).symmetry === "pair" ? !separateFor(id) : (mirrorMap[id] ?? getPart(id).mirrorDefault);

  function pickPart(id: PartId) {
    unlockAudio();
    if (id !== partId) {
      sfx.pop();
      const sep = separateFor(id);
      speak(hintFor(id, mirrorModeOf(id), sep && isTogether(id) ? "B" : "L"));
    }
    setPartId(id);
    writePref("drawPart", id);
    setSide("L");
    setPreview(previewUrl(id, sidesOf(id, draftOf(drafts, id), separateFor(id))));
  }

  function pickAuthor(id: string) {
    setAuthorPref(id);
    writePref("author", id);
  }

  /** [거울 모드] ↔ [일반 모드] */
  function chooseMode(mirrorMode: boolean) {
    if (mirrorMode === mirrorModeOf(partId)) return;
    unlockAudio();
    speak(mirrorMode ? MODE_SAY.mirror : MODE_SAY.free);
    if (part.symmetry === "pair") chooseSeparate(!mirrorMode);
    else {
      setMirrorMap((m) => ({ ...m, [partId]: mirrorMode }));
      sfx.pop();
    }
  }

  /** 짝 부위: 거울(한쪽만) ↔ 따로(양쪽 다) */
  function chooseSeparate(next: boolean) {
    if (next === separate) return;
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
      speak("짠! 저장했어요");
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
  const bigSrcs = { ...resolveFace({ ...DEFAULT_FACE, ...faceMix }) };
  if (preview) bigSrcs[partId] = preview;
  else delete bigSrcs[partId];

  function openFaceCheck() {
    unlockAudio();
    sfx.pop();
    setFaceCheck(true);
    speak(preview ? "짠! 내 그림을 얼굴에 붙여 봤어요" : "아직 그린 게 없어요");
  }

  /** 다른 부위를 슬롯 후보에서 아무거나 골라 내 그림을 대 본다. 이 단계에서 안 도는 부위는 기본 얼굴 그대로 */
  function shuffleFace() {
    unlockAudio();
    sfx.pop();
    const next: Partial<Record<PartId, PartRef>> = {};
    const withSamples = readPref("samples", true);
    for (const p of activeParts(level)) {
      if (p.id === partId) continue;
      // 슬롯 설정을 따른다: 예시를 껐으면 가족 그림 중에서만 (없는 부위는 기본 얼굴 그대로)
      const pool = candidates(p.id, state?.drawings ?? [], withSamples);
      const now = faceMix[p.id] ?? DEFAULT_FACE[p.id];
      const others = pool.length > 1 ? pool.filter((i) => i.ref !== now) : pool;
      next[p.id] = others[Math.floor(Math.random() * others.length)]?.ref ?? DEFAULT_FACE[p.id];
    }
    setFaceMix(next);
  }

  const canUndo = history.past.length > 0;
  const pickColor = (c: string) => {
    setColor(c);
    setTool("pen");
  };
  // 늘 보이는 6색이 아닌 색(🌈 창의 크레용·팔레트 색)이면 🌈 버튼 가운데에 그 색을 보여 준다
  const paletteOn = tool === "pen" && !MAIN_CRAYONS.includes(color);
  const author = authorId ? authorById.get(authorId) : undefined;

  return (
    <div className="screen draw-screen">
      <header className={`draw-head ${tabs.length > 3 ? "is-many" : ""}`} style={{ "--tabs": tabs.length } as CSSProperties}>
        <nav className="part-tabs" aria-label="부위">
          {tabs.map((id) => {
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
                <small>{p.label}</small>
              </button>
            );
          })}
        </nav>
      </header>

      <div className="draw-body">
        <section className="canvas-col">
          <div className="draw-options">
            <div className="segmented small mode-switch" role="radiogroup" aria-label="그리는 방법">
              <button type="button" role="radio" aria-checked={mirrorMode} className={mirrorMode ? "on" : ""} onClick={() => chooseMode(true)}>
                🪞 거울 모드
              </button>
              <button type="button" role="radio" aria-checked={!mirrorMode} className={!mirrorMode ? "on" : ""} onClick={() => chooseMode(false)}>
                ✏️ 일반 모드
              </button>
            </div>
            <span className="options-spacer" />
            <button
              type="button"
              className="author-chip current"
              style={{ borderColor: author?.color, background: author?.color }}
              onClick={() => setAuthorSheet(true)}
              aria-label="그린 사람 고르기"
            >
              <span aria-hidden>{author?.emoji ?? "🙂"}</span>
              <span className="author-name">{author?.name ?? "누구?"}</span>
            </button>
            <button type="button" className="mini-preview" onClick={openFaceCheck} aria-label="얼굴 전체로 보기">
              <FaceView srcs={miniSrcs} dimOthers={partId} />
              <span className="mini-zoom" aria-hidden>
                🔍
              </span>
            </button>
          </div>

          <div className="canvas-area">
            {/* 귀 일반 모드: 캔버스 양옆 빈자리에 왼쪽·오른쪽 (그 쪽에 있는 버튼이 그 쪽 귀) */}
            {separate && !together &&
              (["L", "R"] as const).map((s) => (
                <button
                  type="button"
                  key={s}
                  role="radio"
                  aria-checked={side === s}
                  className={`ear-side ear-side-${s} ${side === s ? "on" : ""}`}
                  onClick={() => {
                    sfx.pop();
                    setSide(s);
                    speak(hintFor(partId, false, s));
                  }}
                >
                  <span aria-hidden>{s === "L" ? "◀" : "▶"}</span>
                  <small>{s === "L" ? "왼쪽" : "오른쪽"}</small>
                </button>
              ))}
            <DrawCanvas
              part={part}
              side={activeSide}
              hint={hintFor(partId, mirrorMode, activeSide)}
              strokes={history.present}
              tool={tool}
              color={color}
              size={SIZES[sizeIdx]}
              mirror={mirror}
              onCommit={(s) => changeHistory((h) => pushStroke(h, s))}
            />
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
                className={`crayon ${MORE_CRAYONS.includes(c) ? "more" : ""} ${tool === "pen" && color === c ? "on" : ""}`}
                style={{ background: c }}
                onClick={() => pickColor(c)}
              />
            ))}
            <button
              type="button"
              className={`crayon rainbow ${paletteOn ? "on" : ""}`}
              onClick={() => {
                unlockAudio();
                sfx.pop();
                setPalette(true);
              }}
              aria-label="다른 색 고르기 (팔레트)"
            >
              <span aria-hidden style={paletteOn ? { background: color } : undefined}>
                {paletteOn ? "" : "🌈"}
              </span>
            </button>
          </div>

          <div className="tools">
            <div className="sizes" role="radiogroup" aria-label="굵기">
              {SIZES.map((sz, i) => (
                <button
                  type="button"
                  key={sz}
                  role="radio"
                  aria-checked={sizeIdx === i}
                  aria-label={["가늘게", "보통", "굵게"][i]}
                  className={`size-btn ${sizeIdx === i ? "on" : ""}`}
                  onClick={() => setSizeIdx(i)}
                >
                  <span style={{ width: 6 + i * 7, height: 6 + i * 7, background: tool === "eraser" ? "#bbb" : color }} />
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`tool-btn ${tool === "eraser" ? "on" : ""}`}
              onClick={() => setTool(tool === "eraser" ? "pen" : "eraser")}
              aria-pressed={tool === "eraser"}
              aria-label="지우개"
            >
              🧽
            </button>
            <button type="button" className="tool-btn" onClick={() => changeHistory(undo)} disabled={!canUndo} aria-label="하나 되돌리기">
              ↶
            </button>
            <button
              type="button"
              className="tool-btn"
              onClick={() => changeHistory(clearAll)}
              disabled={history.present.length === 0}
              aria-label="다 지우기"
            >
              🗑
            </button>
            <button type="button" className="save-btn" onClick={save} disabled={saving || cooldown > 0}>
              {saving ? "저장 중…" : cooldown > 0 ? `⏳ ${cooldown}초` : "✔ 저장"}
            </button>
          </div>

          <div className="strip-row">
            <button type="button" className="slot-go" onClick={() => go("slot")} aria-label="슬롯으로 가서 돌리기">
              <span aria-hidden>🎰</span>슬롯
            </button>
            <div className="strip" aria-label={`${part.label} 그림 ${list.length}장`} {...drag}>
              {list.length === 0 ? (
                <p className="strip-empty">
                  저장한 {part.label} 그림이 여기 모여요 {part.emoji}
                </p>
              ) : (
                <>
                  <span className="strip-count">
                    {part.emoji}
                    <b>{list.length}</b>
                  </span>
                  {list.map((d) => {
                    const a = d.authorId ? authorById.get(d.authorId) : undefined;
                    return (
                      <button
                        type="button"
                        key={d.id}
                        className={`strip-item ${d.id === justAdded ? "is-new" : ""}`}
                        style={{ borderColor: a?.color }}
                        onClick={() => setPicked(d)}
                      >
                        <img src={drawingUrl(d.id)} alt={`${part.label} 그림`} loading="lazy" draggable={false} />
                        {a && <span className="strip-author">{a.emoji}</span>}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      {palette && <ColorSheet color={color} onPick={pickColor} onClose={() => setPalette(false)} />}
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
      {faceCheck && (
        <Sheet title="얼굴 전체로 보기" onClose={() => setFaceCheck(false)}>
          <div className="face-check">
            <div className="face-check-stage">
              <FaceView srcs={bigSrcs} />
              {!preview && (
                <p className="face-check-empty">
                  {part.emoji} 아직 {part.label} 그림이 없어요
                </p>
              )}
            </div>
            <div className="form-actions">
              <button type="button" className="ghost-btn" onClick={shuffleFace} aria-label="다른 얼굴에 대 보기">
                🔀 다른 얼굴
              </button>
              <button type="button" className="primary-btn" onClick={() => setFaceCheck(false)}>
                ✏️ 계속 그리기
              </button>
            </div>
          </div>
        </Sheet>
      )}
      {authorSheet && <AuthorSheet currentId={authorId} onClose={() => setAuthorSheet(false)} onPicked={pickAuthor} />}
    </div>
  );
}
