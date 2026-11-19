// 그린 획을 저장용 PNG(부위 imageBox 크기, 1단위 = 1px)로 만든다.
// 짝 부위: 왼쪽을 그리고 오른쪽은 거울로 붙이거나(양쪽 같이), 따로 그린 오른쪽을 붙이거나(귀), 양쪽을 한 캔버스에 그린 획을 그대로 쓴다(눈·눈썹).
import { imageBox, type PartDef } from "@shared/parts";
import { renderStrokes, type Stroke } from "./strokes";

/**
 * left: 왼쪽(또는 거울 붓 부위 전체) 획
 * right: 귀처럼 오른쪽을 따로 그린 획. null 이면 왼쪽을 거울로
 * both: 눈처럼 양쪽을 한 캔버스에 같이 그린 획 (있으면 left·right 대신 쓴다)
 */
export interface Sides {
  left: readonly Stroke[];
  right: readonly Stroke[] | null;
  both?: readonly Stroke[] | null;
}

function sideCanvas(part: PartDef, strokes: readonly Stroke[]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = part.draw.w;
  c.height = part.draw.h;
  const ctx = c.getContext("2d");
  if (ctx) renderStrokes(ctx, strokes, part.draw.w);
  return c;
}

export function renderPart(part: PartDef, sides: Sides): HTMLCanvasElement {
  const box = imageBox(part);
  const out = document.createElement("canvas");
  out.width = box.w;
  out.height = box.h;
  const ctx = out.getContext("2d");
  if (!ctx) return out;
  if (sides.both) {
    renderStrokes(ctx, sides.both, box.w);
    return out;
  }
  // 쪽마다 따로 그려서 지우개가 다른 쪽을 지우지 않고, 영역 밖으로 나간 선은 잘린다
  const left = sideCanvas(part, sides.left);
  ctx.drawImage(left, 0, 0);
  if (part.symmetry === "pair") {
    if (sides.right) {
      ctx.drawImage(sideCanvas(part, sides.right), box.w - part.draw.w, 0);
    } else {
      ctx.save();
      ctx.translate(box.w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(left, 0, 0);
      ctx.restore();
    }
  }
  return out;
}

/** 칠해진 픽셀 수. 너무 적으면 빈 그림으로 본다 */
export function inkPixels(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 24) count++;
  return count;
}

export const MIN_INK = 60;

export function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG 를 만들지 못했어요"))), "image/png");
  });
}
