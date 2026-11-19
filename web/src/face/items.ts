// 부위별 그림 후보(릴 항목) 만들기와 참조(그림 id·예시) 풀기.
import { REEL_WINDOW } from "@shared/limits";
import { PARTS, type PartId } from "@shared/parts";
import type { Drawing, PartRef } from "@shared/types";
import { drawingUrl } from "../lib/api";
import { SAMPLES, sampleRef, sampleSrc } from "../samples/samples";

export interface ReelItem {
  ref: PartRef;
  src: string;
  /** 예시 그림이면 null */
  authorId: string | null;
}

export function sampleItems(part: PartId): ReelItem[] {
  return SAMPLES[part].map((src, i) => ({ ref: sampleRef(i), src, authorId: null }));
}

export function drawingItem(d: Drawing): ReelItem {
  return { ref: d.id, src: drawingUrl(d.id), authorId: d.authorId };
}

/** 보이는(숨기지 않은) 그림, 최근 것부터 */
export function activeDrawings(drawings: Drawing[], part: PartId): Drawing[] {
  return drawings
    .filter((d) => d.part === part && !d.hiddenAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** 슬롯 후보: 그린 그림 + (켜져 있거나 그린 게 없으면) 예시 그림 */
export function candidates(part: PartId, drawings: Drawing[], includeSamples: boolean): ReelItem[] {
  const drawn = activeDrawings(drawings, part).map(drawingItem);
  return includeSamples || drawn.length === 0 ? [...drawn, ...sampleItems(part)] : drawn;
}

/** 참조를 그림 주소로. 숨긴 그림도 앨범에서는 보여야 하므로 그대로 푼다 */
export function resolveSrc(part: PartId, ref: PartRef | undefined): string | null {
  if (!ref) return null;
  return sampleSrc(part, ref) ?? drawingUrl(ref);
}

export function resolveFace(parts: Partial<Record<PartId, PartRef>>): Partial<Record<PartId, string>> {
  const out: Partial<Record<PartId, string>> = {};
  for (const p of PARTS) {
    const src = resolveSrc(p.id, parts[p.id]);
    if (src) out[p.id] = src;
  }
  return out;
}

/** 기본 단계에서 고정되는 얼굴, 그리기 화면의 흐린 배경 얼굴 */
export const DEFAULT_FACE: Record<PartId, PartRef> = {
  ears: "sample-0",
  face: "sample-0",
  eyes: "sample-0",
  nose: "sample-0",
  mouth: "sample-0",
  brows: "sample-0",
  hair: "sample-0",
};

export function shuffle<T>(list: T[], random: () => number = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 한 판에 쓸 릴 항목: 후보에서 REEL_WINDOW 개까지 무작위로 뽑아 섞는다.
 * 지금 보이는 그림을 맨 앞에 두어 릴이 보이던 그림에서 출발하게 한다.
 */
export function reelWindow(all: ReelItem[], currentRef: PartRef | null, random: () => number = Math.random): ReelItem[] {
  const current = all.find((i) => i.ref === currentRef);
  const rest = shuffle(
    all.filter((i) => i !== current),
    random,
  ).slice(0, REEL_WINDOW - (current ? 1 : 0));
  return current ? [current, ...rest] : rest;
}
