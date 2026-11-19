// 릴 하나. React 렌더 없이 DOM(img 3장)을 직접 움직인다 — 7개 릴이 60fps 로 돌아도 가볍다.
// 그림이 수백 장이어도 창에 보이는 2~3장만 src 를 바꿔 가며 재활용한다.
import type { ReelItem } from "../face/items";
import { easeOutBack, mod, planStop, spinSpeed } from "./reelMath";

type Phase = "idle" | "spinning" | "stopping";

interface Hooks {
  onTick: () => void;
  onLanded: (item: ReelItem) => void;
  /** 창 한가운데 보이는 칸이 바뀌었을 때 (썸네일 줄의 불빛을 옮긴다) */
  onShow?: (index: number) => void;
}

export class Reel {
  private readonly imgs: HTMLImageElement[] = [];
  private readonly shownSrc: (string | null)[] = [null, null, null];
  items: ReelItem[] = [];
  /** 지금 items 의 그림 목록 (같은 목록이면 다시 넣지 않는다) */
  key = "";
  offset = 0;
  phase: Phase = "idle";
  private speed = 0;
  private spinStart = 0;
  private lastFrame = 0;
  private lastWhole = 0;
  private lastShown = -1;
  private stopPlan: { from: number; target: number; start: number; duration: number } | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly hooks: Hooks,
  ) {
    el.replaceChildren();
    for (let i = 0; i < 3; i++) {
      const img = document.createElement("img");
      img.alt = "";
      img.draggable = false;
      img.className = "reel-img";
      el.appendChild(img);
      this.imgs.push(img);
    }
  }

  setItems(items: ReelItem[], showIndex = 0): void {
    this.items = items;
    this.key = items.map((i) => i.ref).join(",");
    this.lastShown = -1;
    this.offset = showIndex;
    this.phase = "idle";
    this.speed = 0;
    this.stopPlan = null;
    this.render();
  }

  /** 창 한가운데 있는 칸 번호 (items 안의 위치) */
  index(): number {
    return this.items.length === 0 ? -1 : mod(Math.round(this.offset), this.items.length);
  }

  current(): ReelItem | null {
    if (this.items.length === 0) return null;
    return this.items[this.index()];
  }

  start(now: number): void {
    if (this.items.length === 0) return;
    this.phase = "spinning";
    this.spinStart = now;
    this.lastFrame = now;
    this.lastWhole = Math.floor(this.offset);
    this.speed = 0;
    this.el.classList.add("reel-spinning");
  }

  /** 멈추기 시작. 이미 멈추는 중이거나 서 있으면 false */
  requestStop(now: number, avoidRef: string | null): boolean {
    if (this.phase !== "spinning") return false;
    const { target, durationMs } = planStop(
      this.offset,
      this.speed,
      this.items.map((i) => i.ref),
      avoidRef,
    );
    this.stopPlan = { from: this.offset, target, start: now, duration: durationMs };
    this.phase = "stopping";
    return true;
  }

  /** 한 프레임 진행. 아직 움직이면 true */
  frame(now: number): boolean {
    if (this.phase === "idle") return false;
    const dt = Math.max(0, now - this.lastFrame);
    this.lastFrame = now;
    const before = this.offset;

    if (this.phase === "spinning") {
      this.speed = spinSpeed(now - this.spinStart);
      this.offset += (this.speed * dt) / 1000;
    } else if (this.stopPlan) {
      const { from, target, start, duration } = this.stopPlan;
      const u = Math.min(1, (now - start) / duration);
      this.offset = from + (target - from) * easeOutBack(u);
      this.speed = dt > 0 ? (Math.abs(this.offset - before) * 1000) / dt : 0;
      if (u >= 1) {
        this.offset = target;
        this.phase = "idle";
        this.speed = 0;
        this.stopPlan = null;
        this.el.classList.remove("reel-spinning", "reel-fast");
        this.render();
        const item = this.current();
        if (item) this.hooks.onLanded(item);
        return false;
      }
    }

    const whole = Math.floor(this.offset);
    if (whole !== this.lastWhole) {
      this.lastWhole = whole;
      this.hooks.onTick();
    }
    this.el.classList.toggle("reel-fast", this.speed > 6);
    this.render();
    return true;
  }

  /** 그림 k 는 translateY((offset - k) * 100%) 에 놓인다 — offset 이 커지면 그림이 아래로 내려간다 */
  private render(): void {
    const shown = this.index();
    if (shown !== this.lastShown) {
      this.lastShown = shown;
      if (shown >= 0) this.hooks.onShow?.(shown);
    }
    const n = this.items.length;
    const base = Math.floor(this.offset);
    for (let k = base - 1; k <= base + 1; k++) {
      const slot = mod(k, 3);
      const img = this.imgs[slot];
      if (n === 0) {
        img.style.visibility = "hidden";
        continue;
      }
      const src = this.items[mod(k, n)].src;
      if (this.shownSrc[slot] !== src) {
        img.src = src;
        this.shownSrc[slot] = src;
      }
      const y = (this.offset - k) * 100;
      img.style.visibility = Math.abs(y) >= 100 ? "hidden" : "visible";
      img.style.transform = `translate3d(0, ${y.toFixed(2)}%, 0)`;
    }
  }
}

/** 이미지를 미리 받아 디코드해 둔다 (릴이 돌 때 깜빡이지 않게). 오래 걸리면 기다리지 않는다 */
const decoded = new Set<string>();
export async function preload(srcs: string[], timeoutMs = 1200): Promise<void> {
  const todo = [...new Set(srcs)].filter((s) => !decoded.has(s));
  const work = Promise.all(
    todo.map(async (src) => {
      const img = new Image();
      img.src = src;
      try {
        await img.decode();
        decoded.add(src);
      } catch {
        // 못 불러온 그림은 빈 칸으로 지나간다
      }
    }),
  );
  await Promise.race([work, new Promise((r) => setTimeout(r, timeoutMs))]);
}
