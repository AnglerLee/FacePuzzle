// 획(벡터) 그리기와 실행 취소 기록. 좌표는 그리는 영역(draw box) 안쪽 얼굴 단위다.

export type Tool = "pen" | "eraser";

export interface Stroke {
  tool: Tool;
  color: string;
  /** 굵기 (얼굴 단위) */
  size: number;
  /** 거울 붓: 영역 가운데 세로줄 기준으로 한 번 더 그린다 */
  mirror: boolean;
  /** x,y,x,y,... */
  points: number[];
}

const mid = (a: number, b: number) => (a + b) / 2;

function applyStyle(ctx: CanvasRenderingContext2D, s: Stroke): void {
  ctx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

/** 획 하나 전체를 중점 이차곡선으로 그린다 */
function tracePath(ctx: CanvasRenderingContext2D, p: number[]): void {
  const n = p.length / 2;
  ctx.beginPath();
  if (n === 1) {
    ctx.arc(p[0], p[1], ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(p[0], p[1]);
  ctx.lineTo(mid(p[0], p[2]), mid(p[1], p[3]));
  for (let i = 2; i < n; i++) {
    const x1 = p[(i - 1) * 2];
    const y1 = p[(i - 1) * 2 + 1];
    ctx.quadraticCurveTo(x1, y1, mid(x1, p[i * 2]), mid(y1, p[i * 2 + 1]));
  }
  ctx.lineTo(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
  ctx.stroke();
}

function withMirror(ctx: CanvasRenderingContext2D, s: Stroke, boxW: number, draw: () => void): void {
  draw();
  if (!s.mirror) return;
  ctx.save();
  ctx.translate(boxW, 0);
  ctx.scale(-1, 1);
  draw();
  ctx.restore();
}

/** 이미 변환(얼굴 단위 → 픽셀)이 걸린 ctx 에 획을 그린다 */
export function renderStroke(ctx: CanvasRenderingContext2D, s: Stroke, boxW: number): void {
  ctx.save();
  applyStyle(ctx, s);
  withMirror(ctx, s, boxW, () => tracePath(ctx, s.points));
  ctx.restore();
}

export function renderStrokes(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[], boxW: number): void {
  for (const s of strokes) renderStroke(ctx, s, boxW);
}

/**
 * 그리는 중인 획의 마지막 조각만 그린다 (전체를 다시 그리지 않아도 renderStroke 와 같은 모양이 된다).
 * i 는 새로 들어온 점의 번호.
 */
export function renderSegment(ctx: CanvasRenderingContext2D, s: Stroke, i: number, boxW: number): void {
  const p = s.points;
  ctx.save();
  applyStyle(ctx, s);
  withMirror(ctx, s, boxW, () => {
    ctx.beginPath();
    if (i === 1) {
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(mid(p[0], p[2]), mid(p[1], p[3]));
    } else {
      const x0 = p[(i - 2) * 2];
      const y0 = p[(i - 2) * 2 + 1];
      const x1 = p[(i - 1) * 2];
      const y1 = p[(i - 1) * 2 + 1];
      ctx.moveTo(mid(x0, x1), mid(y0, y1));
      ctx.quadraticCurveTo(x1, y1, mid(x1, p[i * 2]), mid(y1, p[i * 2 + 1]));
    }
    ctx.stroke();
  });
  ctx.restore();
}

/** 점 하나(탭)를 그린다 */
export function renderDot(ctx: CanvasRenderingContext2D, s: Stroke, boxW: number): void {
  ctx.save();
  applyStyle(ctx, s);
  withMirror(ctx, s, boxW, () => {
    ctx.beginPath();
    ctx.arc(s.points[0], s.points[1], s.size / 2, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

/** 가로 폭 width 기준으로 좌우를 뒤집은 획 (거울 모드 → 일반 모드로 넘길 때) */
export function mirrorStroke(s: Stroke, width: number): Stroke {
  const points = s.points.map((v, i) => (i % 2 === 0 ? width - v : v));
  return { ...s, points };
}

// ── 실행 취소 기록 ──
export interface History {
  past: Stroke[][];
  present: Stroke[];
  future: Stroke[][];
}

const MAX_PAST = 60;

export const emptyHistory = (): History => ({ past: [], present: [], future: [] });

export const historyOf = (present: Stroke[]): History => ({ past: [], present, future: [] });

export function pushStroke(h: History, s: Stroke): History {
  return { past: [...h.past, h.present].slice(-MAX_PAST), present: [...h.present, s], future: [] };
}

export function clearAll(h: History): History {
  if (h.present.length === 0) return h;
  return { past: [...h.past, h.present].slice(-MAX_PAST), present: [], future: [] };
}

export function undo(h: History): History {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
