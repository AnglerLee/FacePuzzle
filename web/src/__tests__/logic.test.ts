import { getPart, PARTS } from "@shared/parts";
import { grayColor, hslToHex, pushRecent, readRecent, spectrumColor } from "../draw/colors";
import { fillRegion, regionFor } from "../draw/DrawCanvas";
import { clearAll, emptyHistory, mirrorStroke, pushStroke, redo, undo, type Stroke } from "../draw/strokes";
import { candidates, sampleItems } from "../face/items";
import { SAMPLES } from "../samples/samples";
import { buildWindows, MARKS, nextBlank, partAt } from "../slot/layout";
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

describe("거울 모드 → 일반 모드", () => {
  it("한쪽 획을 거울로 뒤집어 오른쪽에 옮긴다", () => {
    const s: Stroke = { tool: "pen", color: "#000", size: 10, mirror: false, points: [10, 20, 100, 50] };
    expect(mirrorStroke(s, 620).points).toEqual([610, 20, 520, 50]);
    expect(s.points).toEqual([10, 20, 100, 50]);
  });
});

const drawing = (id: string, part: Drawing["part"], hidden = false): Drawing => ({
  id,
  part,
  authorId: "aaaaaaaaaaaaaaaa",
  createdAt: new Date().toISOString(),
  bytes: 10,
  ...(hidden ? { hiddenAt: new Date().toISOString() } : {}),
});

describe("후보와 예시 그림", () => {

  it("모든 부위에 예시 그림이 있다", () => {
    for (const p of PARTS) expect(SAMPLES[p.id].length).toBeGreaterThanOrEqual(3);
  });

  it("예시를 끄면 그린 그림만 (안 그린 부위는 비고), 숨긴 그림은 빠진다", () => {
    const list = [drawing("0000000000000001", "eyes"), drawing("0000000000000002", "eyes", true)];
    expect(candidates("eyes", list, false).map((i) => i.ref)).toEqual(["0000000000000001"]);
    expect(candidates("nose", list, false)).toHaveLength(0);
    expect(candidates("nose", list, true)).toHaveLength(sampleItems("nose").length);
    expect(candidates("eyes", list, true)).toHaveLength(1 + sampleItems("eyes").length);
    const win = buildWindows("basic", list, false, 1, {});
    expect(win.eyes.map((i) => i.ref)).toEqual(["0000000000000001"]);
    expect(win.nose).toHaveLength(0);
    // 그림이 있는 부위만 다음 차례가 된다
    expect(nextBlank("basic", { eyes: "0000000000000001" }, new Set(["eyes"]))).toBeNull();
  });

});

describe("슬롯 줄 (릴 항목 = 썸네일 순서)", () => {
  const many = Array.from({ length: 40 }, (_, i) => drawing(i.toString(16).padStart(16, "0"), "eyes"));

  it("같은 seed 면 같은 순서이고 24개를 넘지 않는다", () => {
    const a = buildWindows("basic", many, true, 7, {});
    expect(a.eyes.map((i) => i.ref)).toEqual(buildWindows("basic", many, true, 7, {}).eyes.map((i) => i.ref));
    expect(a.eyes).toHaveLength(24);
    expect(new Set(a.eyes.map((i) => i.ref)).size).toBe(24);
    // 기본 단계에서 안 도는 부위는 예시 하나로 고정, 심화에서는 후보 전부
    expect(a.hair).toHaveLength(1);
    expect(buildWindows("advanced", many, true, 7, {}).hair).toHaveLength(SAMPLES.hair.length);
  });

  it("얼굴에 붙어 있는 그림은 후보가 바뀌어도 줄에 남는다", () => {
    const a = buildWindows("basic", many, true, 7, {});
    const outside = many.map((d) => d.id).find((id) => !a.eyes.some((i) => i.ref === id))!;
    const b = buildWindows("basic", many, true, 7, { eyes: outside });
    expect(b.eyes.some((i) => i.ref === outside)).toBe(true);
    expect(b.eyes).toHaveLength(24);
  });

  it("그림 하나를 지워도 나머지 썸네일 순서는 그대로, seed 가 바뀌면 순서도 바뀐다", () => {
    const a = buildWindows("basic", many, true, 7, {}).eyes.map((i) => i.ref);
    const gone = a[3];
    const b = buildWindows("basic", many.filter((d) => d.id !== gone), true, 7, {}).eyes.map((i) => i.ref);
    // 지운 칸만 빠지고, 줄 밖에 있던 그림 하나가 끝에 들어온다
    expect(b.slice(0, 23)).toEqual(a.filter((ref) => ref !== gone));
    expect(b).not.toContain(gone);
    expect(buildWindows("basic", many, true, 8, {}).eyes.map((i) => i.ref)).not.toEqual(a);
  });

  it("다음에 돌릴 부위는 줄 순서대로", () => {
    expect(nextBlank("basic", {})).toBe("eyes");
    expect(nextBlank("basic", { eyes: "sample-0" })).toBe("nose");
    expect(nextBlank("basic", { eyes: "sample-0", nose: "sample-1", mouth: "sample-0" })).toBeNull();
    expect(nextBlank("advanced", { eyes: "sample-0", nose: "sample-1", mouth: "sample-0" })).toBe("face");
  });

  it("빈자리의 ? 를 누르면 그 부위가 잡힌다", () => {
    for (const p of PARTS) for (const [x, y] of MARKS[p.id]) expect(partAt(x, y, PARTS)).toBe(p.id);
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

  it("남는 칸은 배율을 바꾸지 않고 얼굴을 더 보여 주되 얼굴 밖으로는 안 나간다", () => {
    const r = { x: 100, y: 400, w: 600, h: 200 };
    const tall = fillRegion(r, 1);
    expect(tall).toEqual({ x: 100, y: 200, w: 600, h: 600 });
    const wide = fillRegion({ x: 400, y: 500, w: 200, h: 200 }, 2);
    expect(wide).toEqual({ x: 300, y: 500, w: 400, h: 200 });
    // 얼굴 끝에 붙으면 안쪽으로 밀고, 1000 을 넘으면 1000 까지만
    expect(fillRegion({ x: 0, y: 900, w: 400, h: 100 }, 1)).toEqual({ x: 0, y: 600, w: 400, h: 400 });
    expect(fillRegion({ x: 0, y: 400, w: 1000, h: 200 }, 0.5).h).toBe(1000);
  });
});

describe("팔레트 색", () => {
  it("HSL 을 #rrggbb 로 바꾼다", () => {
    expect(hslToHex(0, 100, 50)).toBe("#ff0000");
    expect(hslToHex(120, 100, 50)).toBe("#00ff00");
    expect(hslToHex(240, 100, 50)).toBe("#0000ff");
    expect(hslToHex(0, 0, 100)).toBe("#ffffff");
    expect(hslToHex(0, 0, 0)).toBe("#000000");
  });

  it("무지개 판: 가로는 색깔, 위는 밝게 아래는 어둡게, 판 밖을 눌러도 판 끝 색", () => {
    expect(spectrumColor(0, 0.5)).toBe(hslToHex(0, 90, 53.5));
    expect(spectrumColor(1 / 3, 0.5)).toBe(hslToHex(120, 90, 53.5));
    const light = spectrumColor(0.5, 0);
    const dark = spectrumColor(0.5, 1);
    const sum = (hex: string) => [1, 3, 5].reduce((n, i) => n + parseInt(hex.slice(i, i + 2), 16), 0);
    expect(sum(light)).toBeGreaterThan(sum(dark) + 300);
    expect(spectrumColor(-1, 2)).toBe(spectrumColor(0, 1));
    expect(grayColor(0)).toBe("#ffffff");
    expect(grayColor(1)).toBe("#000000");
  });

  it("내가 만든 색은 최근 것부터 6개까지, 크레용 색·이상한 값은 안 넣는다", () => {
    localStorage.clear();
    for (const c of ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777"]) pushRecent(c);
    pushRecent("#2b2b2b"); // 크레용
    pushRecent("red");
    pushRecent("#333333"); // 이미 있으면 맨 앞으로
    expect(readRecent()).toEqual(["#333333", "#777777", "#666666", "#555555", "#444444", "#222222"]);
  });
});
