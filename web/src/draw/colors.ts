// 그리기 색: 늘 보이는 크레용, 🌈 창의 크레용, 팔레트(무지개 판)에서 고른 색 계산, 최근 쓴 색.
import { readPref, writePref } from "../lib/prefs";

/** 늘 보이는 크레용 6개. 나머지는 🌈 를 누르면 나온다 (작은 폰에서도 한 줄에 크게) */
export const MAIN_CRAYONS = ["#2b2b2b", "#8b5a2b", "#ef4444", "#f472b6", "#facc15", "#3b5bdb"];
export const MORE_CRAYONS = ["#f6c7a1", "#fb923c", "#22c55e", "#38bdf8", "#a855f7", "#ffffff"];
export const CRAYONS = [...MAIN_CRAYONS, ...MORE_CRAYONS];

const HEX = /^#[0-9a-f]{6}$/;
const RECENT_KEY = "recentColors";
const RECENT_MAX = 6;

/** HSL(색상 0~360, 채도·밝기 0~100) → #rrggbb */
export function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 무지개 판에서 누른 자리의 색. x: 왼쪽→오른쪽 빨주노초파남보, y: 위(밝게)→아래(어둡게).
 * 판 그림(CSS 그라디언트)과 같은 규칙이라 누른 자리에 보이는 색이 나온다.
 */
export function spectrumColor(x: number, y: number): string {
  return hslToHex(clamp01(x) * 360, 90, 95 - clamp01(y) * 83);
}

/** 회색 막대: 왼쪽 흰색 → 오른쪽 검은색 */
export function grayColor(x: number): string {
  return hslToHex(0, 0, 100 - clamp01(x) * 100);
}

export function readRecent(): string[] {
  const list = readPref<unknown>(RECENT_KEY, []);
  return Array.isArray(list) ? list.filter((c): c is string => typeof c === "string" && HEX.test(c)).slice(0, RECENT_MAX) : [];
}

/** 팔레트에서 고른 색을 최근 쓴 색 맨 앞에 (크레용 색은 이미 있으니 넣지 않는다) */
export function pushRecent(color: string): void {
  if (!HEX.test(color) || CRAYONS.includes(color)) return;
  writePref(RECENT_KEY, [color, ...readRecent().filter((c) => c !== color)].slice(0, RECENT_MAX));
}
