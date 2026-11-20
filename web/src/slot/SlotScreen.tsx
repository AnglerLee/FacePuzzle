// 슬롯 화면: 맨 얼굴에서 시작해 부위를 하나씩 돌려 얼굴을 완성한다.
// - 부위 줄(또는 얼굴의 ? 자리)을 누르면 그 부위만 돈다. 한 번 더 누르면 멈춘다. 다 채우면 별명이 붙는다.
// - [모두 돌려!]는 한꺼번에 돌리고, [모두 멈춰!]를 누르면 머리부터 차례로 멈춘다.
// - 부위 줄에는 그 릴에 든 그림이 썸네일로 나란히 보인다("이 중에서 나와요"). 돌 때는 불빛이 지금 칸을 따라간다.
// - 돌아간 부위가 모두 같은 가족 작가 그림이면 잭팟.
// - 재미: 완성되면 얼굴이 자기 이름을 말하고(읽어주기 + 입 움직임) 반응 이모지가 뜬다.
//   평소에는 눈을 깜빡이며 두리번거리고, 기본 단계에서 안 도는 부위를 누르면 흔들린다.
// - 부위 줄을 꾹 누르면(길게 누르기) 그린 그림에 ✕ 가 떠서 하나씩 지운다. 예시 그림은 못 지운다.
// - 부모용 설정(단계·예시 섞기·소리·읽어주기·그린 그림 초기화)은 ⚙️ 설정 창에 모았다.
import { findJackpot } from "@shared/jackpot";
import { LIMITS } from "@shared/limits";
import { randomName } from "@shared/names";
import { activeParts, getPart, PARTS, PARTS_BY_STOP, PARTS_BY_Z, type Level, type PartId } from "@shared/parts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { Screen } from "../app/App";
import { useData } from "../app/data";
import { boxStyle } from "../face/FaceView";
import { activeDrawings, candidates, type ReelItem } from "../face/items";
import { friendlyError } from "../lib/api";
import { dragScroll } from "../lib/dragScroll";
import { longPress } from "../lib/longPress";
import { readPref, writePref } from "../lib/prefs";
import { buzz, isMuted, setMuted, sfx, unlockAudio } from "../lib/sound";
import { isSpeechOn, setSpeech, speak, stopSpeaking } from "../lib/speech";
import { Confetti } from "../ui/Confetti";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/Toast";
import { Ghost } from "./Ghost";
import { buildWindows, isSampleRef, itemsKey, MARKS, nextBlank, partAt, ROW_ORDER, type Picks } from "./layout";
import { preload, Reel } from "./reel";

const STOP_GAP_MS = 300;
const AUTO_STOP_MS = 15_000;
const NUDGE_MS = 1300;
const SHAKE: Keyframe[] = [
  { transform: "rotate(0)" },
  { transform: "rotate(-2.5deg)" },
  { transform: "rotate(2.5deg)" },
  { transform: "rotate(-1.5deg)" },
  { transform: "rotate(0)" },
];
const WIGGLE: Keyframe[] = [
  { transform: "translateY(0) rotate(0)" },
  { transform: "translateY(-3%) rotate(-4deg)" },
  { transform: "translateY(0) rotate(4deg)" },
  { transform: "translateY(-1%) rotate(-2deg)" },
  { transform: "translateY(0) rotate(0)" },
];
/** 부위가 멈춰 붙을 때 통 튄다 */
const BOING: Keyframe[] = [{ transform: "scale(1)" }, { transform: "scale(1.14)" }, { transform: "scale(0.96)" }, { transform: "scale(1)" }];
const RING_POP: Keyframe[] = [{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }];
const REACTIONS = ["😂", "🤣", "😆", "😍", "😮", "🤪", "😎", "🥳", "😜", "🙈"];

interface Kept {
  level: Level;
  seed: number;
  picks: Picks;
  name: string | null;
  jackpotId: string | null;
  saved: boolean;
}
/** 그리기·앨범에 다녀와도 만들던 얼굴이 그대로 있게 (새로고침하면 맨 얼굴부터) */
let kept: Kept | null = null;

type RefFn = (el: HTMLDivElement | null) => void;

export function SlotScreen({ go }: { go: (s: Screen) => void }) {
  const { state, authorById, addAlbum, hideDrawing, restoreDrawing, hideParts, restoreBatch } = useData();
  const toast = useToast();
  const [level, setLevel] = useState<Level>(() => (readPref<string>("level", "basic") === "advanced" ? "advanced" : "basic"));
  const [restored] = useState(() => (kept && kept.level === level ? kept : null));
  const [seed, setSeed] = useState(() => restored?.seed ?? Math.floor(Math.random() * 1e9));
  const [picks, setPicks] = useState<Picks>(() => restored?.picks ?? {});
  const [name, setName] = useState<string | null>(() => restored?.name ?? null);
  const [jackpotId, setJackpotId] = useState<string | null>(() => restored?.jackpotId ?? null);
  const [saved, setSaved] = useState(() => restored?.saved ?? false);
  const [withSamples, setWithSamples] = useState<boolean>(() => readPref("samples", true));
  const [muted, setMutedState] = useState(isMuted);
  const [speech, setSpeechState] = useState(isSpeechOn);
  const [settings, setSettings] = useState(false);
  const [spinning, setSpinning] = useState<ReadonlySet<PartId>>(new Set());
  const [loadingAll, setLoadingAll] = useState(false);
  const [stoppingAll, setStoppingAll] = useState(false);
  const [pop, setPop] = useState(0);
  const [saving, setSaving] = useState(false);
  const [talking, setTalking] = useState(false);
  const [reaction, setReaction] = useState<{ emoji: string; key: number } | null>(null);
  /** 길게 눌러 ✕ 가 뜬 부위 줄 */
  const [editing, setEditing] = useState<PartId | null>(null);
  /** 설정의 [그린 그림 초기화] 창과 거기서 고른 부위 */
  const [resetPick, setResetPick] = useState<ReadonlySet<PartId> | null>(null);
  const [resetting, setResetting] = useState(false);

  const reels = useRef(new Map<PartId, Reel>());
  const partEls = useRef(new Map<PartId, HTMLDivElement>());
  const tracks = useRef(new Map<PartId, HTMLDivElement>());
  const rings = useRef(new Map<PartId, HTMLDivElement>());
  const spinningRef = useRef(new Set<PartId>());
  const picksRef = useRef<Picks>(picks);
  const prevRefs = useRef(new Map<PartId, string | null>());
  const starting = useRef(new Set<PartId>());
  const stopCount = useRef(0);
  const loopOn = useRef(false);
  const timers = useRef<number[]>([]);
  const autoStop = useRef(0);
  const talkTimer = useRef(0);
  const nudgeTimer = useRef(0);
  const scrolledOnce = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [drag] = useState(dragScroll);
  const [press] = useState(longPress);
  /** 릴·창 크기 알림이 부르는 최신 처리 함수 (렌더마다 바꿔 끼운다) */
  const handlers = useRef<{ landed: (id: PartId) => void; show: (id: PartId, index: number) => void; relayout: () => void }>({
    landed: () => {},
    show: () => {},
    relayout: () => {},
  });

  const drawings = useMemo(() => state?.drawings ?? [], [state]);
  const loaded = state !== null;
  const active = useMemo(() => activeParts(level), [level]);
  const rows = useMemo(() => {
    const ids = new Set(active.map((p) => p.id));
    return ROW_ORDER.filter((id) => ids.has(id)).map(getPart);
  }, [active]);
  const windows = useMemo(() => buildWindows(level, drawings, withSamples, seed, picks), [level, drawings, withSamples, seed, picks]);
  const totals = useMemo(() => {
    const out: Partial<Record<PartId, number>> = {};
    for (const p of active) out[p.id] = candidates(p.id, drawings, withSamples).length;
    return out;
  }, [active, drawings, withSamples]);
  /** 부위별 그린 그림 수 (초기화 창). 지금 단계에서 안 도는 부위도 센다 */
  const drawnCounts = useMemo(() => {
    const out = {} as Record<PartId, number>;
    for (const p of PARTS) out[p.id] = activeDrawings(drawings, p.id).length;
    return out;
  }, [drawings]);
  const drawnTotal = PARTS.reduce((sum, p) => sum + drawnCounts[p.id], 0);
  const resetCount = PARTS.reduce((sum, p) => sum + (resetPick?.has(p.id) ? drawnCounts[p.id] : 0), 0);

  // 돌릴 그림이 있는 부위 (예시 그림을 끄고 아직 안 그린 부위는 빈 줄로 남는다)
  const playable = useMemo(() => rows.filter((p) => windows[p.id].length > 0), [rows, windows]);
  const playableIds = useMemo(() => new Set(playable.map((p) => p.id)), [playable]);

  const anySpin = spinning.size > 0;
  const isActive = (id: PartId) => rows.some((p) => p.id === id);
  const complete = !anySpin && !loadingAll && playable.length > 0 && playable.every((p) => picks[p.id]);
  const nextId = anySpin || loadingAll ? null : nextBlank(level, picks, playableIds);

  // ── 썸네일 줄의 불빛 ──
  /** 불빛을 index 번째 썸네일로 옮긴다. follow 면 그 썸네일이 보이게 줄을 민다 */
  function placeRing(id: PartId, follow: boolean, index = reels.current.get(id)?.index() ?? -1, smooth = false) {
    const track = tracks.current.get(id);
    const ring = rings.current.get(id);
    if (!track || !ring || index < 0) return;
    const tile = track.querySelectorAll<HTMLElement>(".thumb-item")[index];
    if (!tile) return;
    ring.style.transform = `translate(${tile.offsetLeft}px, ${tile.offsetTop}px)`;
    if (!follow) return;
    const left = tile.offsetLeft;
    const w = tile.offsetWidth;
    if (left >= track.scrollLeft && left + w <= track.scrollLeft + track.clientWidth) return;
    const target = Math.max(0, left - (track.clientWidth - w) / 2);
    if (smooth) track.scrollTo({ left: target, behavior: "smooth" });
    else track.scrollLeft = target;
  }

  /** 얼굴이 말한다: 읽어주기 + 입 움직임 (읽어주기를 못 쓰면 입만 잠깐 움직인다) */
  function say(text: string) {
    window.clearTimeout(talkTimer.current);
    setTalking(true);
    const started = performance.now();
    // 음성이 없거나 바로 끝나도 입은 이름 길이만큼은 움직인다
    const minMs = Math.min(2500, 500 + [...text].length * 90);
    const stop = () => {
      window.clearTimeout(talkTimer.current);
      const left = minMs - (performance.now() - started);
      talkTimer.current = window.setTimeout(() => setTalking(false), Math.max(0, left));
    };
    const spoken = speak(text, { onEnd: stop });
    // 끝났다는 알림이 안 올 때를 대비한 최대 시간
    talkTimer.current = window.setTimeout(() => setTalking(false), spoken ? 6000 : minMs);
  }

  // ── 얼굴이 다 찼을 때 ──
  function finish() {
    const results = active.map((p) => reels.current.get(p.id)?.current()).filter((x): x is ReelItem => !!x);
    // 잭팟은 얼굴 전체로 따지므로 후보 작가는 돌아가는 단계의 모든 부위에서 모은다
    const authors = new Set<string>();
    for (const p of active) for (const item of candidates(p.id, drawings, withSamples)) if (item.authorId) authors.add(item.authorId);
    const winner = findJackpot(results, authors);
    const newName = randomName();
    setName(newName);
    setPop((n) => n + 1);
    setJackpotId(winner);
    setReaction({ emoji: REACTIONS[Math.floor(Math.random() * REACTIONS.length)], key: Date.now() });
    if (winner) {
      sfx.fanfare();
      buzz([60, 40, 60, 40, 140]);
    } else {
      sfx.done();
      buzz(30);
    }
    // 효과음이 끝날 즈음 얼굴이 자기 이름을 말한다
    const who = winner ? authorById.get(winner)?.name : undefined;
    window.setTimeout(() => say(who ? `${who} 잭팟! 나는 ${newName}!` : `나는 ${newName}!`), winner ? 900 : 350);
  }

  /** 아직 빈 부위가 있으면 잠시 뒤 다음 부위를 말해 준다 (그 사이 다시 누르면 취소) */
  function nudge(next: PartId) {
    window.clearTimeout(nudgeTimer.current);
    nudgeTimer.current = window.setTimeout(() => speak(`${getPart(next).label}도 돌려 봐요!`), NUDGE_MS);
  }

  function landed(id: PartId) {
    if (!spinningRef.current.delete(id)) return;
    const reel = reels.current.get(id);
    const item = reel?.current();
    if (item) picksRef.current = { ...picksRef.current, [id]: item.ref };
    setPicks(picksRef.current);
    setSpinning(new Set(spinningRef.current));
    sfx.stop(stopCount.current++);
    buzz(18);
    partEls.current.get(id)?.animate(BOING, { duration: 420, easing: "ease-out" });
    placeRing(id, true, reel?.index() ?? -1, true);
    rings.current.get(id)?.firstElementChild?.animate(RING_POP, { duration: 420, easing: "ease-out" });
    if (spinningRef.current.size > 0) return;
    window.clearTimeout(autoStop.current);
    clearTimers();
    setStoppingAll(false);
    const next = nextBlank(level, picksRef.current, playableIds);
    if (next) nudge(next);
    else finish();
  }

  // 릴은 렌더마다 새로 만들지 않는다: 부위마다 고정된 ref 콜백이고, 콜백 안에서 최신 처리 함수를 부른다
  const refFns = useMemo(() => {
    const out = {} as Record<PartId, { reel: RefFn; part: RefFn; track: RefFn; ring: RefFn }>;
    for (const p of PARTS) {
      out[p.id] = {
        reel: (el) => {
          if (!el) return;
          if (!reels.current.has(p.id)) {
            reels.current.set(
              p.id,
              new Reel(el, {
                onTick: () => sfx.tick(),
                onLanded: () => handlers.current.landed(p.id),
                onShow: (index) => handlers.current.show(p.id, index),
              }),
            );
          }
          return () => {
            reels.current.delete(p.id);
          };
        },
        part: (el) => {
          if (el) partEls.current.set(p.id, el);
          else partEls.current.delete(p.id);
        },
        track: (el) => {
          if (el) tracks.current.set(p.id, el);
          else tracks.current.delete(p.id);
        },
        ring: (el) => {
          if (el) rings.current.set(p.id, el);
          else rings.current.delete(p.id);
        },
      };
    }
    return out;
  }, []);

  // 렌더마다: 서 있는 릴에 지금 후보를 넣고(그림이 늘거나 단계가 바뀌면), 불빛을 제자리에 둔다
  useLayoutEffect(() => {
    for (const p of PARTS) {
      const reel = reels.current.get(p.id);
      const win = windows[p.id];
      if (!reel || reel.phase !== "idle" || starting.current.has(p.id)) continue;
      if (reel.key !== itemsKey(win)) {
        const want = picksRef.current[p.id] ?? null;
        reel.setItems(win, Math.max(0, win.findIndex((i) => i.ref === want)));
      }
    }
    const follow = !scrolledOnce.current;
    scrolledOnce.current = true;
    for (const p of rows) if (!spinningRef.current.has(p.id)) placeRing(p.id, follow && !!picksRef.current[p.id]);
    handlers.current = {
      landed,
      show: (id, index) => placeRing(id, true, index),
      relayout: () => {
        for (const p of rows) placeRing(p.id, false);
      },
    };
  });

  useEffect(() => {
    kept = { level, seed, picks, name, jackpotId, saved };
  }, [level, seed, picks, name, jackpotId, saved]);

  useEffect(() => {
    const onResize = () => handlers.current.relayout();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      loopOn.current = false;
      for (const t of timers.current) window.clearTimeout(t);
      window.clearTimeout(autoStop.current);
      window.clearTimeout(talkTimer.current);
      window.clearTimeout(nudgeTimer.current);
      press.end();
      stopSpeaking();
    };
  }, [press]);

  // ✕ 가 뜬 줄 밖을 누르면 ✕ 를 거둔다
  useEffect(() => {
    if (!editing) return;
    const onDown = (e: Event) => {
      if (!(e.target instanceof Element) || !e.target.closest(".slot-row.is-editing")) setEditing(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [editing]);

  function runLoop() {
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
  }

  function clearTimers() {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }

  /** 얼굴에 붙은 그림 중 keep 이 아닌 것을 떼어 낸다 (그 자리는 다시 빈자리, 이름도 다시) */
  function keepPicks(keep: (ref: string) => boolean) {
    const cur = picksRef.current;
    if (Object.values(cur).every((ref) => !ref || keep(ref))) return;
    const next = Object.fromEntries(Object.entries(cur).filter(([, ref]) => ref && keep(ref))) as Picks;
    picksRef.current = next;
    setPicks(next);
    setName(null);
    setJackpotId(null);
    setReaction(null);
    setSaved(false);
  }

  /** 지금 얼굴을 지운다 (부위는 다시 빈자리) */
  function clearFace() {
    window.clearTimeout(nudgeTimer.current);
    window.clearTimeout(talkTimer.current);
    stopSpeaking();
    picksRef.current = {};
    setPicks({});
    setTalking(false);
    setName(null);
    setJackpotId(null);
    setReaction(null);
    setSaved(false);
  }

  // ── 돌리기 ──
  /** 부위들을 돌린다. all 이면 [모두 돌려!] (준비하는 동안 버튼을 막는다) */
  async function startParts(ids: PartId[], all: boolean) {
    unlockAudio();
    const targets = ids.filter((id) => {
      const reel = reels.current.get(id);
      return reel?.phase === "idle" && reel.items.length > 0 && !starting.current.has(id);
    });
    if (targets.length === 0) return;
    for (const id of targets) starting.current.add(id);
    setEditing(null);
    window.clearTimeout(nudgeTimer.current);
    stopSpeaking();
    setTalking(false);
    setReaction(null);
    setName(null);
    setJackpotId(null);
    setSaved(false);
    if (all) {
      setLoadingAll(true);
      stageRef.current?.animate(SHAKE, { duration: 420, easing: "ease-in-out" });
    } else {
      sfx.pop();
      buzz(10);
    }

    await preload(targets.flatMap((id) => (reels.current.get(id)?.items ?? []).map((i) => i.src)));

    const now = performance.now();
    if (spinningRef.current.size === 0) stopCount.current = 0;
    for (const id of targets) {
      starting.current.delete(id);
      const reel = reels.current.get(id);
      if (!reel || reel.phase !== "idle") continue;
      prevRefs.current.set(id, picksRef.current[id] ?? null);
      reel.start(now);
      spinningRef.current.add(id);
    }
    setSpinning(new Set(spinningRef.current));
    setLoadingAll(false);
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
    setStoppingAll(true);
    const order = PARTS_BY_STOP.filter((p) => reels.current.get(p.id)?.phase === "spinning");
    order.forEach((p, i) => {
      timers.current.push(window.setTimeout(() => stopPart(p.id), i * STOP_GAP_MS));
    });
  }

  /** 부위를 누르면: 도는 중이면 멈추고, 서 있으면(비었든 찼든) 그 부위만 돈다 */
  function tapPart(id: PartId | null) {
    if (!id || !isActive(id)) return;
    const reel = reels.current.get(id);
    if (!reel) return;
    unlockAudio();
    if (!playableIds.has(id)) {
      askToDraw(id);
      return;
    }
    if (reel.phase === "spinning") {
      stopPart(id);
      return;
    }
    if (reel.phase === "stopping" || loadingAll) return;
    void startParts([id], false);
  }

  function onStagePointer(e: PointerEvent<HTMLDivElement>) {
    // ✕ 가 떠 있을 때 얼굴을 누르면 ✕ 만 거둔다 (돌리지 않는다)
    if (editing) {
      setEditing(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 1000;
    const id = partAt(x, y, rows);
    if (id) {
      tapPart(id);
      return;
    }
    // 이 단계에서 안 도는 부위(기본 단계의 머리 등)는 간지럼 타듯 흔들린다
    const fixed = partAt(x, y, PARTS);
    if (fixed) {
      unlockAudio();
      sfx.pop();
      partEls.current.get(fixed)?.animate(WIGGLE, { duration: 450, easing: "ease-out" });
    }
  }

  function resetFace() {
    if (spinningRef.current.size > 0 || loadingAll) return;
    unlockAudio();
    clearFace();
    setSeed((s) => s + 1);
    sfx.pop();
    buzz(10);
  }

  function drawMore(id: PartId) {
    unlockAudio();
    writePref("drawPart", id);
    go("draw");
  }

  /** 돌릴 그림이 없는 부위를 눌렀을 때: 그리러 가자고 한다 */
  function askToDraw(id: PartId) {
    const p = getPart(id);
    sfx.oops();
    speak(`${p.label} 그림을 그려 주세요`);
    toast(`${p.emoji} ${p.label} 그림이 아직 없어요`, { action: { label: "✏️ 그리러 가기", onClick: () => drawMore(id) } });
  }

  function changeLevel(lv: Level) {
    if (lv === level || spinningRef.current.size > 0 || loadingAll) return;
    setLevel(lv);
    writePref("level", lv);
    setEditing(null);
    clearFace();
    setSeed((s) => s + 1);
  }

  function toggleSamples() {
    // 도는 중에 바꾸면 이미 돌고 있는 릴이 예전 후보로 멈추므로 다 멈춘 뒤에만
    if (spinningRef.current.size > 0 || loadingAll) return;
    const next = !withSamples;
    setWithSamples(next);
    writePref("samples", next);
    // 끄면 얼굴에 붙어 있던 예시 그림도 떼어 낸다 (그 자리는 다시 빈자리)
    if (!next) keepPicks((ref) => !isSampleRef(ref));
  }

  // ── 그린 그림 지우기 ──
  /** 부위 줄을 길게 눌렀을 때: 그린 그림에 ✕ 를 띄운다. 도는 중이면 그냥 둔다(false → 뒤따르는 누르기로 멈춘다) */
  function startEditing(id: PartId): boolean {
    if (spinningRef.current.size > 0 || loadingAll || starting.current.size > 0) return false;
    if (!windows[id].some((item) => !isSampleRef(item.ref))) {
      if (windows[id].length === 0) return false;
      sfx.oops();
      toast("예시 그림은 지울 수 없어요. ⚙️ 설정에서 안 나오게 할 수 있어요");
      return true;
    }
    unlockAudio();
    sfx.pop();
    buzz(30);
    window.clearTimeout(nudgeTimer.current);
    setEditing(id);
    return true;
  }

  async function removeDrawing(part: PartId, id: string) {
    // 마지막 그림을 지우면 ✕ 를 거둔다
    if (!activeDrawings(drawings, part).some((d) => d.id !== id)) setEditing(null);
    try {
      await hideDrawing(id);
      keepPicks((ref) => ref !== id);
      sfx.pop();
      buzz(15);
      toast(`${getPart(part).emoji} 그림을 지웠어요`, {
        action: { label: "되돌리기", onClick: () => void restoreDrawing(id).catch((e) => toast(friendlyError(e), { tone: "error" })) },
      });
    } catch (error) {
      sfx.oops();
      toast(friendlyError(error), { tone: "error" });
    }
  }

  function openReset() {
    setSettings(false);
    setEditing(null);
    setResetPick(new Set(PARTS.filter((p) => drawnCounts[p.id] > 0).map((p) => p.id)));
  }

  function toggleResetPart(id: PartId) {
    setResetPick((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function resetDrawings() {
    if (!resetPick || resetting || spinningRef.current.size > 0 || loadingAll) return;
    const parts = PARTS.filter((p) => resetPick.has(p.id) && drawnCounts[p.id] > 0).map((p) => p.id);
    if (parts.length === 0) return;
    setResetting(true);
    try {
      const { hiddenAt, drawings: gone } = await hideParts(parts);
      const ids = new Set(gone.map((d) => d.id));
      keepPicks((ref) => !ids.has(ref));
      setResetPick(null);
      sfx.pop();
      buzz(30);
      toast(`그린 그림 ${gone.length}장을 지웠어요`, {
        action: { label: "되돌리기", onClick: () => void restoreBatch(hiddenAt).catch((e) => toast(friendlyError(e), { tone: "error" })) },
      });
    } catch (error) {
      sfx.oops();
      toast(friendlyError(error), { tone: "error" });
    } finally {
      setResetting(false);
    }
  }

  function toggleSound() {
    unlockAudio();
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (next) stopSpeaking();
  }

  function toggleSpeech() {
    unlockAudio();
    const next = !speech;
    setSpeech(next);
    setSpeechState(next);
    if (next) speak("안녕! 내가 읽어 줄게");
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

  const jackpotAuthor = complete && jackpotId ? authorById.get(jackpotId) : undefined;
  const showName = complete && name !== null;
  const nothingPicked = rows.every((p) => !picks[p.id]);
  const hint = editing
    ? `✕ 를 누르면 ${getPart(editing).label} 그림이 지워져요`
    : loaded && playable.length === 0
    ? "🎨 그리기에서 그림을 그려 주세요"
    : anySpin
    ? "👆 한 번 더 누르면 멈춰요"
    : loadingAll
      ? "두근두근…"
      : nextId && nothingPicked
        ? "👇 하나씩 눌러서 얼굴을 만들어요"
        : nextId
          ? `👉 ${getPart(nextId).emoji} ${getPart(nextId).label}도 돌려 봐요!`
          : "";
  const bigLabel = loadingAll ? "준비 중…" : stoppingAll ? "멈추는 중…" : anySpin ? "✋ 모두 멈춰!" : "🎰 모두 돌려!";

  return (
    <div className={`screen slot-screen ${rows.length > 3 ? "is-many" : ""}`}>
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
          <div
            ref={stageRef}
            className={`stage ${showName ? "is-result" : ""} ${anySpin ? "is-spinning" : ""} ${jackpotAuthor ? "is-jackpot" : ""} pop-${pop % 2}`}
            onPointerDown={onStagePointer}
          >
            {PARTS_BY_Z.map((p) => {
              const blank = isActive(p.id) && !picks[p.id] && !spinning.has(p.id);
              return (
                <div
                  key={p.id}
                  ref={refFns[p.id].part}
                  data-part={p.id}
                  className={`slot-part part-${p.id} ${blank ? "is-blank" : ""} ${spinning.has(p.id) ? "is-spinning" : ""} ${p.id === "mouth" && talking ? "is-talking" : ""}`}
                  style={boxStyle(p.id)}
                >
                  <div className="reel" ref={refFns[p.id].reel} />
                  {blank && <Ghost part={p} />}
                </div>
              );
            })}
            {playable
              .filter((p) => !picks[p.id] && !spinning.has(p.id))
              .flatMap((p, n) =>
                MARKS[p.id].map(([x, y], i) => (
                  <span
                    key={`${p.id}-${i}`}
                    data-part={p.id}
                    className={`qmark ${nextId === p.id ? "is-next" : ""}`}
                    style={{ left: `${x / 10}%`, top: `${y / 10}%`, animationDelay: `${-(n * 0.35 + i * 0.15)}s` }}
                    aria-hidden
                  >
                    ?
                  </span>
                )),
              )}
            {!loaded && <div className="stage-loading">얼굴 준비 중…</div>}
            {reaction && showName && (
              <span key={reaction.key} className="reaction" aria-hidden>
                {reaction.emoji}
              </span>
            )}
            {/* 이름표는 무대 위쪽(머리 위 빈 곳), 안내·잭팟은 아래쪽 — 얼굴을 화면 폭만큼 크게 쓰려고 무대 안에 띄운다 */}
            {showName && (
              <div className="name-row" onPointerDown={(e) => e.stopPropagation()}>
                <button type="button" className="name-banner" onClick={() => say(`나는 ${name}!`)} aria-label={`${name}, 다시 듣기`}>
                  <span className="name-text">{name}</span>
                </button>
                <button
                  type="button"
                  className="mini-btn round"
                  onClick={() => {
                    const next = randomName();
                    setName(next);
                    setSaved(false);
                    sfx.pop();
                    say(`나는 ${next}!`);
                  }}
                  aria-label="다른 이름"
                >
                  🔄
                </button>
                <button type="button" className="keep-btn" onClick={saveToAlbum} disabled={saving || saved} aria-label="앨범에 담기">
                  {saved ? "✅" : "📒"}
                  <small>{saved ? "담았어요" : "담기"}</small>
                </button>
              </div>
            )}
            {!showName && hint && <p className="stage-hint">{hint}</p>}
            {jackpotAuthor && (
              <>
                <div className="jackpot-banner">
                  🎉 {jackpotAuthor.emoji} {jackpotAuthor.name} 잭팟!
                </div>
                <Confetti seed={pop} />
              </>
            )}
          </div>
        </section>

        <section className="control-col">
          <div className="slot-rows" role="group" aria-label="부위 슬롯">
            {rows.map((p) => {
              const win = windows[p.id];
              const isSpin = spinning.has(p.id);
              const isPicked = !!picks[p.id];
              const more = (totals[p.id] ?? 0) - win.length;
              const empty = win.length === 0;
              const isEdit = editing === p.id;
              return (
                <div
                  key={p.id}
                  data-part={p.id}
                  className={`slot-row ${isSpin ? "is-spinning" : ""} ${isPicked ? "is-picked" : ""} ${nextId === p.id && !editing ? "is-next" : ""} ${empty ? "is-empty" : ""} ${isEdit ? "is-editing" : ""}`}
                  // 꾹 누르면 그린 그림에 ✕ 가 뜬다. 길게 누르고 뗄 때 따라오는 누르기는 막는다
                  onPointerDown={(e) => {
                    if (!isEdit) press.start(e, () => startEditing(p.id));
                  }}
                  onPointerMove={press.move}
                  onPointerUp={press.end}
                  onPointerCancel={press.end}
                  onPointerLeave={press.end}
                  onContextMenu={(e) => e.preventDefault()}
                  onClickCapture={(e) => {
                    if (!press.consumeClick()) return;
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
                  {isEdit ? (
                    <button type="button" className="row-btn" onClick={() => setEditing(null)} aria-label={`${p.label} 지우기 끝내기`}>
                      <span className="row-emoji" aria-hidden>
                        ✔
                      </span>
                      <span className="row-label">완료</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="row-btn"
                      onClick={() => tapPart(p.id)}
                      aria-label={empty ? `${p.label} 그림 없음` : isSpin ? `${p.label} 멈추기` : `${p.label} 돌리기`}
                    >
                      <span className="row-emoji" aria-hidden>
                        {isSpin ? "✋" : p.emoji}
                      </span>
                      <span className="row-label">{isSpin ? "멈춰!" : p.label}</span>
                      {!isSpin && (
                        <span className="row-badge" aria-hidden>
                          {empty ? "✏️" : isPicked ? "🔄" : "▶"}
                        </span>
                      )}
                    </button>
                  )}
                  <div
                    className="track"
                    ref={refFns[p.id].track}
                    onClick={() => (editing ? setEditing(null) : tapPart(p.id))}
                    {...drag}
                  >
                    <div
                      ref={refFns[p.id].ring}
                      className={`lamp ${isSpin ? "is-chasing" : isPicked ? "is-picked" : "is-off"}`}
                      aria-hidden
                    >
                      <span className="lamp-in" />
                    </div>
                    {win.map((item, i) => {
                      const a = item.authorId ? authorById.get(item.authorId) : undefined;
                      const sample = isSampleRef(item.ref);
                      return (
                        <div
                          key={item.ref}
                          className={`thumb thumb-item ${sample ? "is-sample" : ""}`}
                          style={isEdit ? { animationDelay: `${-(i % 3) * 0.11}s` } : undefined}
                        >
                          <img src={item.src} alt="" loading="lazy" draggable={false} />
                          {a && <span className="thumb-author">{a.emoji}</span>}
                          {isEdit && !sample && (
                            <button
                              type="button"
                              className="thumb-x"
                              onClick={(e) => {
                                e.stopPropagation();
                                void removeDrawing(p.id, item.ref);
                              }}
                              aria-label={`${p.label} 그림 지우기`}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {more > 0 && <div className="thumb thumb-more">+{more}</div>}
                    <button
                      type="button"
                      className={`thumb thumb-add ${empty ? "is-wide" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        drawMore(p.id);
                      }}
                      aria-label={`${p.label} 더 그리기`}
                    >
                      <span aria-hidden>✏️</span>
                      <small>{empty ? `아직 없어요! ${p.label} 그리러 가기` : "그리기"}</small>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="slot-bar">
            <button type="button" className="side-btn" onClick={resetFace} disabled={anySpin || loadingAll || nothingPicked}>
              <span aria-hidden>🧼</span>
              <small>맨 얼굴</small>
            </button>
            <button
              type="button"
              className={`big-btn ${anySpin ? "is-stop" : ""}`}
              disabled={loadingAll || stoppingAll || !loaded || (!anySpin && playable.length === 0)}
              onClick={() => (anySpin ? stopAll() : void startParts(playable.map((p) => p.id), true))}
            >
              {bigLabel}
            </button>
            <button type="button" className="side-btn" onClick={() => setSettings(true)}>
              <span aria-hidden>⚙️</span>
              <small>설정</small>
            </button>
          </div>
        </section>
      </div>

      {settings && (
        <Sheet title="설정" onClose={() => setSettings(false)}>
          <div className="settings">
            <div className="setting">
              <span className="setting-label">무엇을 돌릴까요?</span>
              <div className="segmented" role="radiogroup" aria-label="단계">
                <button type="button" role="radio" aria-checked={level === "basic"} className={level === "basic" ? "on" : ""} onClick={() => changeLevel("basic")}>
                  기본 <small>눈·코·입</small>
                </button>
                <button type="button" role="radio" aria-checked={level === "advanced"} className={level === "advanced" ? "on" : ""} onClick={() => changeLevel("advanced")}>
                  심화 <small>+얼굴·귀·머리·눈썹</small>
                </button>
              </div>
            </div>
            <button
              type="button"
              className={`setting-toggle ${withSamples ? "on" : ""}`}
              onClick={toggleSamples}
              aria-pressed={withSamples}
              disabled={anySpin || loadingAll}
            >
              <span>🖼️ 예시 그림도 섞기</span>
              <b>{withSamples ? "켬" : "끔"}</b>
            </button>
            <p className="settings-note">끄면 우리 가족이 그린 그림만 나와요. 아직 안 그린 부위는 비어 있어요.</p>
            <button type="button" className={`setting-toggle ${!muted ? "on" : ""}`} onClick={toggleSound} aria-pressed={!muted}>
              <span>🔊 소리·진동</span>
              <b>{muted ? "끔" : "켬"}</b>
            </button>
            <button type="button" className={`setting-toggle ${speech ? "on" : ""}`} onClick={toggleSpeech} aria-pressed={speech}>
              <span>🗣️ 읽어주기 (얼굴 이름·안내)</span>
              <b>{speech ? "켬" : "끔"}</b>
            </button>
            <button
              type="button"
              className="setting-toggle is-danger"
              onClick={openReset}
              disabled={anySpin || loadingAll || drawnTotal === 0}
            >
              <span>🗑️ 그린 그림 초기화</span>
              <b>{drawnTotal}장</b>
            </button>
            <p className="settings-note">하나씩 지우려면 부위 줄의 그림을 꾹 누르세요. ✕ 가 떠요.</p>
            <p className="settings-note">그린 그림은 집 NAS에 저장돼서 가족 기기 어디서나 같이 보여요.</p>
          </div>
        </Sheet>
      )}

      {resetPick && (
        <Sheet title="그린 그림 초기화" onClose={() => setResetPick(null)}>
          <div className="settings">
            <div className="setting">
              <span className="setting-label">어느 부위 그림을 지울까요?</span>
              <div className="reset-parts">
                {ROW_ORDER.map(getPart)
                  .filter((p) => drawnCounts[p.id] > 0)
                  .map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      className={`reset-chip ${resetPick.has(p.id) ? "on" : ""}`}
                      aria-pressed={resetPick.has(p.id)}
                      onClick={() => toggleResetPart(p.id)}
                    >
                      <span aria-hidden>{resetPick.has(p.id) ? "☑️" : "⬜"}</span>
                      {p.emoji} {p.label} <b>{drawnCounts[p.id]}</b>
                    </button>
                  ))}
              </div>
            </div>
            <p className="settings-note">
              지운 그림은 📒 앨범 › 🗑 휴지통에서 {LIMITS.trashDays}일 동안 되살릴 수 있어요. 앨범에 담은 얼굴은 그대로예요.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  setResetPick(null);
                  setSettings(true);
                }}
              >
                취소
              </button>
              <button
                type="button"
                className="primary-btn danger"
                onClick={resetDrawings}
                disabled={resetCount === 0 || resetting || anySpin || loadingAll}
              >
                {resetting ? "지우는 중…" : `🗑 ${resetCount}장 지우기`}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
