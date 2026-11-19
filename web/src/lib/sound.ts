// 효과음: Web Audio 로 합성해서 소리 파일이 필요 없다. 첫 터치 때 AudioContext 를 연다(브라우저 자동재생 규칙).
import { readPref, writePref } from "./prefs";

let ctx: AudioContext | null = null;
let muted = readPref("muted", false);

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  writePref("muted", value);
}

/** 사용자 터치 이벤트 안에서 부른다 */
export function unlockAudio(): void {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

interface ToneOptions {
  type?: OscillatorType;
  gain?: number;
  at?: number;
  slideTo?: number;
}

function tone(freq: number, duration: number, { type = "sine", gain = 0.12, at = 0, slideTo }: ToneOptions = {}): void {
  if (muted || !ctx || ctx.state !== "running") return;
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

let lastTick = 0;

export const sfx = {
  /** 릴이 한 칸 지나갈 때. 너무 자주 울리지 않게 60ms 간격으로 묶는다 */
  tick() {
    const now = performance.now();
    if (now - lastTick < 60) return;
    lastTick = now;
    tone(1400, 0.035, { type: "square", gain: 0.035 });
  },
  spin() {
    tone(220, 0.35, { type: "sawtooth", gain: 0.05, slideTo: 880 });
  },
  /** 릴이 멈출 때. 순서마다 음이 올라간다 */
  stop(index: number) {
    const notes = [523, 587, 659, 698, 784, 880, 988];
    tone(notes[index % notes.length], 0.18, { type: "triangle", gain: 0.16 });
  },
  done() {
    tone(784, 0.12, { type: "triangle", gain: 0.14 });
    tone(1047, 0.22, { type: "triangle", gain: 0.14, at: 0.1 });
  },
  fanfare() {
    const seq = [523, 659, 784, 1047, 784, 1047];
    seq.forEach((f, i) => tone(f, 0.22, { type: "square", gain: 0.07, at: i * 0.12 }));
  },
  pop() {
    tone(600, 0.08, { type: "sine", gain: 0.12, slideTo: 1200 });
  },
  save() {
    tone(660, 0.1, { type: "triangle", gain: 0.14 });
    tone(990, 0.16, { type: "triangle", gain: 0.14, at: 0.08 });
  },
  oops() {
    tone(300, 0.2, { type: "sine", gain: 0.12, slideTo: 180 });
  },
};

/** 진동 (안드로이드). iOS 는 지원하지 않아 조용히 넘어간다 */
export function buzz(pattern: number | number[]): void {
  if (muted) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // 지원하지 않는 브라우저
  }
}
