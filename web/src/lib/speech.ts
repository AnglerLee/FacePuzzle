// 읽어주기: 글을 아직 못 읽는 아이를 위해 완성 얼굴 이름·잭팟·그릴 부위를 소리로 읽는다 (브라우저 내장 음성).
// 소리를 끄면(음소거) 읽어주기도 멈춘다. 한국어 음성이 없는 기기에서는 조용히 넘어간다.
import { readPref, writePref } from "./prefs";
import { isMuted } from "./sound";

let enabled = readPref("speech", true);
let voice: SpeechSynthesisVoice | null | undefined;

const synth = (): SpeechSynthesis | null =>
  typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

if (synth()) {
  // 음성 목록은 늦게 채워질 수 있다
  synth()!.addEventListener?.("voiceschanged", () => {
    voice = undefined;
  });
}

function koreanVoice(): SpeechSynthesisVoice | null {
  if (voice !== undefined) return voice;
  const list = synth()?.getVoices() ?? [];
  voice = list.find((v) => v.lang?.toLowerCase().startsWith("ko")) ?? null;
  return voice;
}

export function isSpeechOn(): boolean {
  return enabled;
}

export function setSpeech(value: boolean): void {
  enabled = value;
  writePref("speech", value);
  if (!value) synth()?.cancel();
}

interface SpeakOptions {
  onStart?: () => void;
  onEnd?: () => void;
}

/** 읽기 시작했으면 true. 앞서 읽던 말은 끊는다 */
export function speak(text: string, { onStart, onEnd }: SpeakOptions = {}): boolean {
  const s = synth();
  if (!s || !enabled || isMuted()) return false;
  try {
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    const v = koreanVoice();
    if (v) u.voice = v;
    u.rate = 1;
    u.pitch = 1.3;
    if (onStart) u.onstart = onStart;
    if (onEnd) {
      u.onend = onEnd;
      u.onerror = onEnd;
    }
    s.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking(): void {
  synth()?.cancel();
}
