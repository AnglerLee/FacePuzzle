// 부위 하나를 크게 확대해서 그리는 캔버스.
// 아래에 흐린 기본 얼굴(위치감), 그 위에 그릴 영역을 밝게, 맨 위에 반투명 점선 가이드를 깐다.
// 한 손가락만 그린다 — 두 번째 손가락이 닿으면 지금 긋던 선을 취소한다.
import { FACE_SIZE, imageBox, PARTS_BY_Z, rightBox, type Box, type PartDef } from "@shared/parts";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { DEFAULT_FACE, resolveSrc } from "../face/items";
import { renderDot, renderSegment, renderStrokes, type Stroke, type Tool } from "./strokes";

/** L: 왼쪽(또는 부위 전체), R: 오른쪽, B: 짝 부위 양쪽을 한 캔버스에 */
export type Side = "L" | "R" | "B";

/** 그리는 영역 둘레로 얼굴을 조금 더 보여 줄 범위 (얼굴 좌표) */
export function regionFor(box: Box, tight = false): Box {
  const pad = tight ? 24 : Math.max(24, Math.round(Math.max(box.w, box.h) * 0.1));
  const x0 = Math.max(0, box.x - pad);
  const y0 = Math.max(0, box.y - pad);
  const x1 = Math.min(FACE_SIZE, box.x + box.w + pad);
  const y1 = Math.min(FACE_SIZE, box.y + box.h + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * 보여 줄 범위를 캔버스 칸의 비율에 맞춰 넓힌다 (확대 배율은 그대로).
 * 키가 큰 폰에서 눈처럼 가로로 긴 부위를 그릴 때 위아래가 비지 않고 얼굴이 더 보인다.
 */
export function fillRegion(r: Box, target: number): Box {
  if (!(target > 0)) return r;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  if (target < r.w / r.h) {
    const h = Math.min(FACE_SIZE, r.w / target);
    return { x: r.x, y: clamp(r.y + r.h / 2 - h / 2, FACE_SIZE - h), w: r.w, h };
  }
  const w = Math.min(FACE_SIZE, r.h * target);
  return { x: clamp(r.x + r.w / 2 - w / 2, FACE_SIZE - w), y: r.y, w, h: r.h };
}

export function originFor(part: PartDef, side: Side): Box {
  if (part.symmetry !== "pair") return part.draw;
  if (side === "B") return imageBox(part);
  return side === "R" ? rightBox(part) : part.draw;
}

interface Props {
  part: PartDef;
  side: Side;
  strokes: readonly Stroke[];
  tool: Tool;
  color: string;
  size: number;
  mirror: boolean;
  /** 아직 아무것도 안 그렸을 때 위에 띄우는 안내 */
  hint: string;
  onCommit: (stroke: Stroke) => void;
}

const MIN_STEP = 1.2;

/** 긴 머리가 가리는 부위: 이 부위를 그릴 때는 흐린 배경 얼굴에서 머리를 뺀다 */
const HAIR_HIDES = new Set(["ears", "face"]);

export function DrawCanvas({ part, side, strokes, tool, color, size, mirror, hint, onCommit }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [space, setSpace] = useState({ w: 0, h: 0 });
  const [drawing, setDrawing] = useState(false);
  const pointers = useRef(new Set<number>());
  const current = useRef<{ id: number; stroke: Stroke } | null>(null);

  const box = originFor(part, side);
  // 양쪽을 한 번에 그릴 때는 가로로 길어서 둘레를 좁혀 그릴 칸을 키운다. 남는 칸은 얼굴을 더 보여 준다
  const region = fillRegion(regionFor(box, side === "B"), space.h > 0 ? space.w / space.h : 0);
  const aspect = region.w / region.h;
  const boardW = Math.floor(Math.min(space.w, space.h * aspect));
  const board = { w: boardW, h: Math.floor(boardW / aspect) };

  // 들어갈 자리 크기를 잰다 (판은 그 안에 비율을 지켜 들어간다)
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const { width, height } = wrap.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setSpace({ w: Math.floor(width), h: Math.floor(height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  /** 얼굴 단위 → 캔버스 픽셀 변환과 영역 자르기를 건 ctx */
  function prepared(reset: boolean): CanvasRenderingContext2D | null {
    const canvas = canvasRef.current;
    if (!canvas || board.w === 0) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (reset) {
      canvas.width = Math.round(board.w * dpr);
      canvas.height = Math.round(board.h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const k = (board.w * dpr) / region.w;
    ctx.setTransform(k, 0, 0, k, (box.x - region.x) * k, (box.y - region.y) * k);
    ctx.beginPath();
    ctx.rect(0, 0, box.w, box.h);
    ctx.clip();
    return ctx;
  }

  function redrawAll() {
    const ctx = prepared(true);
    if (ctx) renderStrokes(ctx, strokes, box.w);
  }

  // 획 목록·크기가 바뀌면 처음부터 다시 그린다
  useEffect(() => {
    redrawAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, board.w, board.h, part.id, side]);

  function toLocal(e: { clientX: number; clientY: number }): [number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    const fx = region.x + ((e.clientX - rect.left) / rect.width) * region.w;
    const fy = region.y + ((e.clientY - rect.top) / rect.height) * region.h;
    return [fx - box.x, fy - box.y];
  }

  function onDown(e: PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    pointers.current.add(e.pointerId);
    if (pointers.current.size > 1) {
      // 두 번째 손가락: 지금 긋던 선 취소
      if (current.current) {
        current.current = null;
        setDrawing(false);
        redrawAll();
      }
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toLocal(e);
    const stroke: Stroke = {
      tool,
      color,
      size: tool === "eraser" ? size * 1.8 : size,
      mirror: part.symmetry === "mirror" && mirror,
      points: [x, y],
    };
    current.current = { id: e.pointerId, stroke };
    setDrawing(true);
    const ctx = prepared(false);
    if (ctx) renderDot(ctx, stroke, box.w);
  }

  function onMove(e: PointerEvent<HTMLCanvasElement>) {
    const cur = current.current;
    if (!cur || cur.id !== e.pointerId) return;
    const ctx = prepared(false);
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const p = cur.stroke.points;
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const [x, y] = toLocal(ev);
      const lx = p[p.length - 2];
      const ly = p[p.length - 1];
      if (Math.hypot(x - lx, y - ly) < MIN_STEP) continue;
      p.push(x, y);
      if (ctx) renderSegment(ctx, cur.stroke, p.length / 2 - 1, box.w);
    }
  }

  function onUp(e: PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId);
    const cur = current.current;
    if (!cur || cur.id !== e.pointerId) return;
    current.current = null;
    setDrawing(false);
    onCommit(cur.stroke);
  }

  const viewBox = `${region.x} ${region.y} ${region.w} ${region.h}`;
  // 가이드: 왼쪽은 그대로, 오른쪽은 거울로. 양쪽 캔버스면 둘 다 그린다
  const right = rightBox(part);
  const leftGuide = `translate(${part.draw.x}, ${part.draw.y})`;
  const rightGuide = `translate(${right.x + right.w}, ${right.y}) scale(-1, 1)`;
  const guideTransforms =
    part.symmetry !== "pair"
      ? [leftGuide]
      : side === "B"
        ? [leftGuide, rightGuide]
        : side === "R"
          ? [rightGuide]
          : [leftGuide];
  const showHint = strokes.length === 0 && !drawing;

  return (
    <div className="draw-wrap" ref={wrapRef}>
      <div className="draw-board" style={{ width: board.w, height: board.h }}>
        <svg className="draw-context" viewBox={viewBox} preserveAspectRatio="none" aria-hidden>
          {PARTS_BY_Z.filter((p) => p.id !== part.id && !(p.id === "hair" && HAIR_HIDES.has(part.id))).map((p) => {
            const b = imageBox(p);
            return (
              <image
                key={p.id}
                href={resolveSrc(p.id, DEFAULT_FACE[p.id]) ?? undefined}
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                opacity={0.3}
              />
            );
          })}
          <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={18} className="draw-area-rect" />
          {part.symmetry === "mirror" && mirror && (
            <line x1={box.x + box.w / 2} y1={box.y} x2={box.x + box.w / 2} y2={box.y + box.h} className="draw-axis" />
          )}
        </svg>
        <canvas
          ref={canvasRef}
          className="draw-canvas"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
        />
        <svg className="draw-guide" viewBox={viewBox} preserveAspectRatio="none" aria-hidden>
          {guideTransforms.map((t) => (
            <g key={t} transform={t}>
              {part.guide.map((d, i) => (
                <path key={i} d={d} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          ))}
        </svg>
        {showHint && <div className="draw-hint">{hint}</div>}
      </div>
    </div>
  );
}
