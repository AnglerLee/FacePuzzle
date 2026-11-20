// 슬롯 화면의 순수 계산 (테스트한다): 누른 부위 찾기, 빈 부위 표시 위치, 부위별 릴 항목(썸네일 줄과 같은 순서).
import { REEL_WINDOW } from "@shared/limits";
import { activeParts, hitBoxes, PARTS, type Level, type PartDef, type PartId } from "@shared/parts";
import type { Drawing, PartRef } from "@shared/types";
import { candidates, resolveSrc, sampleItems, type ReelItem } from "../face/items";

/** 슬롯 줄 순서: 기본 부위(눈·코·입)가 먼저 (그리기 탭과 같은 순서) */
export const ROW_ORDER: PartId[] = ["eyes", "nose", "mouth", "face", "ears", "hair", "brows"];

/** 아직 안 돌린 부위에 띄우는 물음표 자리 (얼굴 좌표). 누르면 그 부위가 잡히는 곳에 둔다 */
export const MARKS: Record<PartId, [number, number][]> = {
  eyes: [
    [335, 480],
    [665, 480],
  ],
  nose: [[500, 620]],
  mouth: [[500, 780]],
  brows: [
    [335, 345],
    [665, 345],
  ],
  ears: [
    [130, 520],
    [870, 520],
  ],
  face: [[245, 640]],
  hair: [[500, 66]],
};

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

export type Picks = Partial<Record<PartId, PartRef>>;

/** 아직 안 돌린 부위 중 줄 순서로 첫 번째. playable 을 주면 돌릴 그림이 있는 부위만 본다 */
export function nextBlank(level: Level, picks: Picks, playable?: ReadonlySet<PartId>): PartId | null {
  const active = new Set(activeParts(level).map((p) => p.id));
  return ROW_ORDER.find((id) => active.has(id) && !picks[id] && (!playable || playable.has(id))) ?? null;
}

export const isSampleRef = (ref: string) => ref.startsWith("sample-");

/**
 * seed 로 섞되, 그림마다 순번(ref 와 seed 로 정한 값)을 매겨 그 순서로 늘어놓는다.
 * 같은 seed 면 같은 순서라 화면을 다시 그려도 그대로이고,
 * 그림 하나를 지우거나 새로 그려도 나머지끼리의 순서는 그대로라서 썸네일 줄이 통째로 뒤섞이지 않는다.
 */
export function stableShuffle<T extends { ref: string }>(items: readonly T[], seed: number): T[] {
  const rank = (ref: string) => {
    let h = (seed ^ 0x9e3779b9) >>> 0;
    for (let i = 0; i < ref.length; i++) h = Math.imul(h ^ ref.charCodeAt(i), 0x01000193);
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  };
  return items
    .map((item) => ({ item, r: rank(item.ref) }))
    .sort((a, b) => a.r - b.r || (a.item.ref < b.item.ref ? -1 : 1))
    .map((x) => x.item);
}

export const itemsKey = (items: readonly ReelItem[]) => items.map((i) => i.ref).join(",");

/**
 * 부위별 릴 항목. 썸네일 줄도 이 순서 그대로 보여 준다 — "이 중에서 하나가 나와요".
 * 돌아가는 부위: 후보를 seed 로 섞어(stableShuffle) REEL_WINDOW 개까지. 지금 얼굴에 붙은 그림은 꼭 넣는다.
 * 안 도는 부위(기본 단계의 얼굴·귀·머리): 기본 예시 하나.
 */
export function buildWindows(
  level: Level,
  drawings: Drawing[],
  withSamples: boolean,
  seed: number,
  picks: Picks,
): Record<PartId, ReelItem[]> {
  const active = new Set(activeParts(level).map((p) => p.id));
  const out = {} as Record<PartId, ReelItem[]>;
  PARTS.forEach((p, n) => {
    if (!active.has(p.id)) {
      out[p.id] = sampleItems(p.id).slice(0, 1);
      return;
    }
    const all = candidates(p.id, drawings, withSamples);
    let win = stableShuffle(all, seed * 31 + n * 7919).slice(0, REEL_WINDOW);
    const pick = picks[p.id];
    if (pick && !win.some((i) => i.ref === pick)) {
      const item = all.find((i) => i.ref === pick) ?? {
        ref: pick,
        src: resolveSrc(p.id, pick) ?? "",
        authorId: drawings.find((d) => d.id === pick)?.authorId ?? null,
      };
      win = [...win.slice(0, REEL_WINDOW - 1), item];
    }
    out[p.id] = win;
  });
  return out;
}
