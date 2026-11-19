import { getPart, PARTS } from "@shared/parts";
import { regionFor } from "../draw/DrawCanvas";
import { clearAll, emptyHistory, mirrorStroke, pushStroke, redo, undo, type Stroke } from "../draw/strokes";
import { candidates, reelWindow, sampleItems } from "../face/items";
import { SAMPLES } from "../samples/samples";
import { partAt } from "../slot/SlotScreen";
import { easeOutBack, mod, planStop, STOP_SLOPE } from "../slot/reelMath";
import type { Drawing } from "@shared/types";

const stroke = (x: number): Stroke => ({ tool: "pen", color: "#000", size: 10, mirror: false, points: [x, x] });

describe("릴 계산", () => {
  it("멈출 칸은 지금보다 앞쪽 정수 칸이고, 시작 속도가 이어진다", () => {
    const refs = ["a", "b", "c", "d"];
    const plan = planStop(5.3, 12, refs, null);
    expect(Number.isInteger(plan.target)).toBe(true);
    expect(plan.target).toBeGreaterThan(5.3);
    // easeOutBack 의 시작 기울기로 계산한 속도 = 지금 속도
    const startSpeed = (STOP_SLOPE * (plan.target - 5.3)) / plan.durationMs;
    expect(startSpeed * 1000).toBeCloseTo(12, 5);
  });

  it("직전 결과와 같은 그림이면 한 칸 더 간다", () => {
    const refs = ["a", "b", "c", "d"];
    const plain = planStop(0, 12, refs, null);
    const avoid = refs[mod(plain.target, refs.length)];
    expect(planStop(0, 12, refs, avoid).target).toBe(plain.target + 1);
    // 그림이 하나면 피할 수 없다
    expect(planStop(0, 12, ["a"], "a").target).toBe(plain.target);
  });

  it("감속 곡선은 0 에서 시작해 1 에서 끝나고 살짝 넘친다", () => {
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => easeOutBack(i / 49)))).toBeGreaterThan(1);
  });
});

describe("실행 취소", () => {
  it("그리기·지우기·되돌리기", () => {
    let h = emptyHistory();
    h = pushStroke(h, stroke(1));
    h = pushStroke(h, stroke(2));
    h = clearAll(h);
    expect(h.present).toHaveLength(0);
    h = undo(h);
    expect(h.present).toHaveLength(2);
    h = undo(h);
    expect(h.present).toHaveLength(1);
    h = redo(h);
    expect(h.present).toHaveLength(2);
    h = pushStroke(h, stroke(3));
    expect(h.future).toHaveLength(0);
  });
});

describe("양쪽 같이 → 따로 그리기", () => {
  it("한쪽 획을 거울로 뒤집어 오른쪽에 옮긴다", () => {
    const s: Stroke = { tool: "pen", color: "#000", size: 10, mirror: false, points: [10, 20, 100, 50] };
    expect(mirrorStroke(s, 620).points).toEqual([610, 20, 520, 50]);
    expect(s.points).toEqual([10, 20, 100, 50]);
  });
});

describe("후보와 예시 그림", () => {
  const drawing = (id: string, part: Drawing["part"], hidden = false): Drawing => ({
    id,
    part,
    authorId: "aaaaaaaaaaaaaaaa",
    createdAt: new Date().toISOString(),
    bytes: 10,
    ...(hidden ? { hiddenAt: new Date().toISOString() } : {}),
  });

  it("모든 부위에 예시 그림이 있다", () => {
    for (const p of PARTS) expect(SAMPLES[p.id].length).toBeGreaterThanOrEqual(3);
  });

  it("그린 게 없으면 예시 그림을 쓰고, 숨긴 그림은 빠진다", () => {
    const list = [drawing("0000000000000001", "eyes"), drawing("0000000000000002", "eyes", true)];
    expect(candidates("eyes", list, false).map((i) => i.ref)).toEqual(["0000000000000001"]);
    expect(candidates("nose", list, false)).toHaveLength(sampleItems("nose").length);
    expect(candidates("eyes", list, true)).toHaveLength(1 + sampleItems("eyes").length);
  });

  it("릴 창은 지금 보이는 그림부터 시작하고 24개를 넘지 않는다", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ref: `r${i}`, src: "", authorId: null }));
    const win = reelWindow(many, "r42");
    expect(win[0].ref).toBe("r42");
    expect(win).toHaveLength(24);
    expect(new Set(win.map((i) => i.ref)).size).toBe(24);
  });
});

describe("터치와 화면 영역", () => {
  it("겹치면 작은 부위가 먼저 잡힌다", () => {
    const parts = [...PARTS];
    expect(partAt(300, 470, parts)).toBe("eyes");
    expect(partAt(500, 600, parts)).toBe("nose");
    expect(partAt(100, 500, parts)).toBe("ears");
    expect(partAt(500, 910, parts)).toBe("face");
    expect(partAt(500, 100, parts)).toBe("hair");
  });

  it("그리는 범위는 얼굴 밖으로 나가지 않는다", () => {
    for (const p of PARTS) {
      const r = regionFor(p.draw);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1000);
      expect(r.y + r.h).toBeLessThanOrEqual(1000);
    }
    const eyes = regionFor(getPart("eyes").draw);
    expect(eyes.w).toBeGreaterThan(getPart("eyes").draw.w);
  });
});
