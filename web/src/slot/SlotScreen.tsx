// 슬롯 화면: 부위별 릴을 돌리고 멈춰서 얼굴을 완성한다.
// - [돌려!] → 모든 부위가 돈다. [멈춰!] → 머리부터 차례로 멈춘다.
// - 부위(얼굴 위 또는 아래 칩)를 누르면: 도는 중이면 그 부위만 멈추고, 서 있으면 그 부위만 다시 돈다.
// - 다 멈추면 별명이 붙는다.
// - 돌아간 부위가 모두 같은 가족 작가 그림이면 잭팟.
import { findJackpot } from "@shared/jackpot";
import { randomName } from "@shared/names";
import { activeParts, hitBoxes, PARTS, PARTS_BY_STOP, PARTS_BY_Z, type Level, type PartDef, type PartId } from "@shared/parts";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { Screen } from "../app/App";
import { useData } from "../app/data";
import { boxStyle } from "../face/FaceView";
import { activeDrawings, candidates, reelWindow, sampleItems, type ReelItem } from "../face/items";
import { friendlyError } from "../lib/api";
import { readPref, writePref } from "../lib/prefs";
import { buzz, isMuted, setMuted, sfx, unlockAudio } from "../lib/sound";
import { Confetti } from "../ui/Confetti";
import { useToast } from "../ui/Toast";
import { preload, Reel } from "./reel";

type Phase = "ready" | "loading" | "spinning" | "stopping" | "result";

const STOP_GAP_MS = 300;
const AUTO_STOP_MS = 15_000;

/** 얼굴 좌표(0~1000)에서 누른 부위: 가장 작은 영역이 이긴다 (눈이 얼굴보다 먼저) */
export function partAt(x: number, y: number, parts: readonly PartDef[]): PartId | null {
  let best: PartId | null = null;
  let bestArea = Infinity;
  for (const p of parts) {
    for (const b of hitBoxes(p)) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h && b.w * b.h < bestArea) {
        best = p.id;
        bestArea = b.w * b.h;
      }
    }
  }
  return best;
}

export function SlotScreen({ go }: { go: (s: Screen) => void }) {
  const { state, authorById, addAlbum } = useData();
  const toast = useToast();
  const [level, setLevel] = useState<Level>(() => (readPref<string>("level", "basic") === "advanced" ? "advanced" : "basic"));
  const [withSamples, setWithSamples] = useState<boolean>(() => readPref("samples", true));
  const [muted, setMutedState] = useState(isMuted);
  const [phase, setPhase] = useState<Phase>("ready");
  const [spinning, setSpinning] = useState<ReadonlySet<PartId>>(new Set());
  const [name, setName] = useState<string | null>(null);
  const [jackpotId, setJackpotId] = useState<string | null>(null);
  const [pop, setPop] = useState(0);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const reels = useRef(new Map<PartId, Reel>());
  const spinningRef = useRef(new Set<PartId>());
  const prevRefs = useRef(new Map<PartId, string | null>());
  const candidateAuthors = useRef(new Set<string>());
  const spunParts = useRef<PartId[]>([]);
  const stopCount = useRef(0);
  const loopOn = useRef(false);
  const timers = useRef<number[]>([]);
  const autoStop = useRef(0);
  const starting = useRef(new Set<PartId>());

  const active = useMemo(() => activeParts(level), [level]);
  const drawings = useMemo(() => state?.drawings ?? [], [state]);
  const loaded = state !== null;

  // ── 릴이 다 멈췄을 때 ──
  const finish = useCallback(() => {
    const results = spunParts.current
      .map((id) => reels.current.get(id)?.current())
      .filter((x): x is ReelItem => !!x);
    const winner = findJackpot(results, candidateAuthors.current);
    setPhase("result");
    setName(randomName());
    setPop((n) => n + 1);
    setJackpotId(winner);
    if (winner) {
      sfx.fanfare();
      buzz([60, 40, 60, 40, 140]);
    } else {
      sfx.done();
      buzz(30);
    }
  }, []);

  const landed = useCallback(
    (part: PartId) => {
      if (!spinningRef.current.delete(part)) return;
      setSpinning(new Set(spinningRef.current));
      sfx.stop(stopCount.current++);
      buzz(18);
      if (spinningRef.current.size === 0) finish();
    },
    [finish],
  );

  // 부위마다 고정된 ref 콜백 (렌더마다 새로 만들면 릴이 다시 만들어진다)
  const reelRefs = useMemo(() => {
    const out = {} as Record<PartId, (el: HTMLDivElement | null) => void>;
    for (const p of PARTS) {
      out[p.id] = (el) => {
        if (!el) return;
        if (!reels.current.has(p.id)) {
          reels.current.set(p.id, new Reel(el, { onTick: () => sfx.tick(), onLanded: () => landed(p.id) }));
        }
        return () => {
          reels.current.delete(p.id);
        };
      };
    }
    return out;
  }, [landed]);

  /** 부위별로 처음 보일 그림을 고른다 (돌지 않는 부위는 기본 예시 얼굴) */
  const setupFace = useCallback(
    (lv: Level) => {
      const lvActive = new Set(activeParts(lv).map((p) => p.id));
      for (const p of PARTS) {
        const reel = reels.current.get(p.id);
        if (!reel) continue;
        if (lvActive.has(p.id)) reel.setItems(reelWindow(candidates(p.id, drawings, withSamples), null), 0);
        else reel.setItems(sampleItems(p.id).slice(0, 1), 0);
      }
    },
    [drawings, withSamples],
  );

  // 데이터가 오면 아직 빈 릴에 얼굴을 차린다 (StrictMode 에서 릴이 다시 만들어져도 다시 채운다)
  useEffect(() => {
    if (!loaded) return;
    if ([...reels.current.values()].some((r) => r.items.length === 0)) setupFace(level);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(
    () => () => {
      loopOn.current = false;
      for (const t of timers.current) window.clearTimeout(t);
      window.clearTimeout(autoStop.current);
    },
    [],
  );

  const runLoop = useCallback(() => {
    if (loopOn.current) return;
    loopOn.current = true;
    const step = () => {
      if (!loopOn.current) return;
      const now = performance.now();
      let moving = false;
      for (const reel of reels.current.values()) if (reel.frame(now)) moving = true;
      if (moving) requestAnimationFrame(step);
      else loopOn.current = false;
    };
    requestAnimationFrame(step);
  }, []);

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };

  // ── 돌리기 ──
  /** 부위들을 돌린다. all 이면 [돌려!] 버튼 (준비하는 동안 버튼을 막는다) */
  async function startParts(ids: PartId[], all: boolean) {
    unlockAudio();
    const targets = ids.filter((id) => reels.current.get(id)?.phase === "idle" && !starting.current.has(id));
    if (targets.length === 0) return;
    for (const id of targets) starting.current.add(id);
    if (all) setPhase("loading");
    setName(null);
    setJackpotId(null);
    setSaved(false);

    // 잭팟은 얼굴 전체로 따지므로 후보 작가는 돌아가는 단계의 모든 부위에서 모은다
    const authors = new Set<string>();
    const windows = new Map<PartId, ReelItem[]>();
    for (const p of active) {
      const all = candidates(p.id, drawings, withSamples);
      for (const item of all) if (item.authorId) authors.add(item.authorId);
      if (targets.includes(p.id)) windows.set(p.id, reelWindow(all, reels.current.get(p.id)?.current()?.ref ?? null));
    }
    candidateAuthors.current = authors;
    spunParts.current = active.map((p) => p.id);
    await preload([...windows.values()].flat().map((i) => i.src));

    const now = performance.now();
    if (spinningRef.current.size === 0) stopCount.current = 0;
    for (const [id, items] of windows) {
      starting.current.delete(id);
      const reel = reels.current.get(id);
      if (!reel || reel.phase !== "idle") continue;
      prevRefs.current.set(id, reel.current()?.ref ?? null);
      reel.setItems(items, 0);
      reel.start(now);
      spinningRef.current.add(id);
    }
    setSpinning(new Set(spinningRef.current));
    setPhase("spinning");
    sfx.spin();
    buzz(25);
    runLoop();
    window.clearTimeout(autoStop.current);
    autoStop.current = window.setTimeout(() => stopAll(), AUTO_STOP_MS);
  }

  function stopPart(id: PartId) {
    const reel = reels.current.get(id);
    if (reel?.requestStop(performance.now(), prevRefs.current.get(id) ?? null)) sfx.pop();
  }

  function stopAll() {
    if (spinningRef.current.size === 0) return;
    clearTimers();
    window.clearTimeout(autoStop.current);
    setPhase("stopping");
    const order = PARTS_BY_STOP.filter((p) => reels.current.get(p.id)?.phase === "spinning");
    order.forEach((p, i) => {
      timers.current.push(window.setTimeout(() => stopPart(p.id), i * STOP_GAP_MS));
    });
  }

  /** 부위를 누르면: 도는 중이면 멈추고, 서 있으면 그 부위만 다시 돈다 */
  function tapPart(id: PartId | null) {
    if (!id || !active.some((p) => p.id === id)) return;
    const reel = reels.current.get(id);
    if (!reel) return;
    unlockAudio();
    if (reel.phase === "spinning") {
      stopPart(id);
      return;
    }
    if (reel.phase === "stopping" || phase === "loading") return;
    sfx.pop();
    buzz(10);
    void startParts([id], false);
  }

  function onStagePointer(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 1000;
    tapPart(partAt(x, y, active));
  }

  function changeLevel(lv: Level) {
    if (lv === level || phase === "spinning" || phase === "stopping" || phase === "loading") return;
    setLevel(lv);
    writePref("level", lv);
    setPhase("ready");
    setName(null);
    setJackpotId(null);
    setupFace(lv);
  }

  function toggleSamples() {
    const next = !withSamples;
    setWithSamples(next);
    writePref("samples", next);
  }

  function toggleSound() {
    unlockAudio();
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  }

  async function saveToAlbum() {
    if (!name || saving || saved) return;
    const parts: Partial<Record<PartId, string>> = {};
    for (const p of PARTS) {
      const ref = reels.current.get(p.id)?.current()?.ref;
      if (ref) parts[p.id] = ref;
    }
    setSaving(true);
    try {
      await addAlbum({ name, parts });
      setSaved(true);
      sfx.save();
      toast("앨범에 담았어요 📒", { tone: "success", action: { label: "보러 가기", onClick: () => go("album") } });
    } catch (error) {
      sfx.oops();
      toast(friendlyError(error), { tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  const busy = phase === "loading" || phase === "stopping";
  const bigLabel =
    phase === "spinning"
      ? "멈춰!"
      : phase === "stopping"
        ? "멈추는 중…"
        : phase === "loading"
          ? "준비 중…"
          : phase === "result"
            ? "모두 다시 돌려!"
            : "돌려!";
  const totalDrawn = drawings.filter((d) => !d.hiddenAt).length;
  const jackpotAuthor = jackpotId ? authorById.get(jackpotId) : undefined;

  return (
    <div className="screen slot-screen">
      <header className="topbar">
        <button type="button" className="nav-btn" onClick={() => go("draw")}>
          <span aria-hidden>🎨</span>그리기
        </button>
        <h1 className="title">뒤죽박죽 얼굴</h1>
        <button type="button" className="nav-btn" onClick={() => go("album")}>
          <span aria-hidden>📒</span>앨범
        </button>
      </header>

      <div className="slot-body">
        <section className="stage-col">
          <div className={`stage ${phase === "result" ? "is-result" : ""} pop-${pop % 2}`} onPointerDown={onStagePointer}>
            {PARTS_BY_Z.map((p) => (
              <div
                key={p.id}
                ref={reelRefs[p.id]}
                className={`reel reel-${p.id} ${spinning.has(p.id) ? "is-turning" : ""}`}
                style={boxStyle(p.id)}
              />
            ))}
            {!loaded && <div className="stage-loading">얼굴 준비 중…</div>}
            {jackpotAuthor && phase === "result" && <Confetti seed={pop} />}
          </div>

          <div className="result-row">
            {phase === "result" && jackpotAuthor && (
              <div className="jackpot-banner">
                🎉 {jackpotAuthor.emoji} {jackpotAuthor.name} 잭팟! 🎉
              </div>
            )}
            {phase === "result" && name ? (
              <div className="name-banner">
                <span className="name-text">{name}</span>
                <button type="button" className="mini-btn" onClick={() => setName(randomName())} aria-label="다른 이름">
                  🔄
                </button>
              </div>
            ) : (
              <p className="hint">
                {phase === "spinning"
                  ? "얼굴을 톡 누르면 그 부위만 멈춰요"
                  : totalDrawn === 0
                    ? "예시 그림으로 먼저 돌려 봐요! 🎨 그리기에서 내 그림을 더해요"
                    : "돌려서 웃긴 얼굴을 만들어 봐요"}
              </p>
            )}
          </div>
        </section>

        <section className="control-col">
          <button
            type="button"
            className={`big-btn ${phase === "spinning" ? "is-stop" : ""}`}
            disabled={busy || !loaded}
            onClick={() => (phase === "spinning" ? stopAll() : void startParts(active.map((p) => p.id), true))}
          >
            {bigLabel}
          </button>

          <div className={`chips ${active.length > 3 ? "is-many" : ""}`} role="group" aria-label="부위">
            {active.map((p) => {
              const count = activeDrawings(drawings, p.id).length;
              const isSpinning = spinning.has(p.id);
              return (
                <button
                  type="button"
                  key={p.id}
                  className={`chip ${isSpinning ? "is-spinning" : ""}`}
                  onClick={() => tapPart(p.id)}
                  aria-label={isSpinning ? `${p.label} 멈추기` : `${p.label}만 돌리기`}
                >
                  <span className="chip-emoji" aria-hidden>
                    {p.emoji}
                  </span>
                  <span className="chip-label">{p.label}</span>
                  <span className="chip-count">{isSpinning ? "멈춤" : `${count}장`}</span>
                </button>
              );
            })}
          </div>
          <p className="chips-help">
            {spinning.size > 0 ? "도는 부위를 누르면 그 부위만 멈춰요" : "부위를 누르면 그 부위만 다시 돌아가요 🔄"}
          </p>

          {phase === "result" && (
            <button type="button" className="album-btn" onClick={saveToAlbum} disabled={saving || saved}>
              {saved ? "✅ 앨범에 담았어요" : "📒 앨범에 담기"}
            </button>
          )}

          <div className="settings">
            <div className="segmented" role="radiogroup" aria-label="단계">
              <button type="button" role="radio" aria-checked={level === "basic"} className={level === "basic" ? "on" : ""} onClick={() => changeLevel("basic")}>
                기본 <small>눈·코·입</small>
              </button>
              <button type="button" role="radio" aria-checked={level === "advanced"} className={level === "advanced" ? "on" : ""} onClick={() => changeLevel("advanced")}>
                심화 <small>+얼굴·귀·머리·눈썹</small>
              </button>
            </div>
            <div className="toggles">
              <button type="button" className={`toggle ${withSamples ? "on" : ""}`} onClick={toggleSamples} aria-pressed={withSamples}>
                {withSamples ? "✅" : "⬜"} 예시 그림 섞기
              </button>
              <button type="button" className={`toggle ${muted ? "" : "on"}`} onClick={toggleSound} aria-pressed={!muted}>
                {muted ? "🔇 소리 끔" : "🔊 소리 켬"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
