// 메모리 토큰 버킷. 키(IP 등)마다 burst 개까지 쓰고 windowMs 동안 다시 찬다.
// 키 수는 maxKeys 로 묶고(가장 오래 안 쓴 키부터 버림), 가득 찬 버킷은 주기적으로 지운다.
// 서버가 다시 뜨면 비워진다 — 그래도 저장 할당량(store.ts)이 총량을 묶는다.
import type { BucketRule } from "@shared/limits";

interface Bucket {
  tokens: number;
  at: number;
}

const SWEEP_EVERY_MS = 10 * 60_000;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly perMs: number;
  private lastSweep = 0;

  constructor(
    readonly name: string,
    private readonly rule: BucketRule,
    private readonly maxKeys = 10_000,
  ) {
    this.perMs = rule.burst / rule.windowMs;
  }

  /** 지금 남은 토큰(채운 뒤). 버킷을 만들거나 바꾸지 않는다 */
  private level(key: string, now: number): number {
    const b = this.buckets.get(key);
    if (!b) return this.rule.burst;
    return Math.min(this.rule.burst, b.tokens + (now - b.at) * this.perMs);
  }

  /** 1개를 쓸 수 있으면 0, 아니면 기다려야 하는 ms */
  waitMs(key: string, now: number): number {
    const tokens = this.level(key, now);
    return tokens >= 1 ? 0 : Math.ceil((1 - tokens) / this.perMs);
  }

  consume(key: string, now: number): void {
    const tokens = this.level(key, now);
    this.buckets.delete(key); // 다시 넣어 가장 최근으로 (Map 순서 = LRU)
    this.buckets.set(key, { tokens: Math.max(0, tokens - 1), at: now });
    if (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    if (now - this.lastSweep > SWEEP_EVERY_MS) this.sweep(now);
  }

  /** 다 차서 새 버킷과 다를 것 없는 키를 지운다 */
  sweep(now: number): void {
    this.lastSweep = now;
    for (const key of [...this.buckets.keys()]) {
      if (this.level(key, now) >= this.rule.burst) this.buckets.delete(key);
    }
  }

  get size(): number {
    return this.buckets.size;
  }

  reset(): void {
    this.buckets.clear();
    this.lastSweep = 0;
  }
}

export interface LimitCheck {
  limiter: RateLimiter;
  key: string;
}

/** 모두 통과할 때만 한꺼번에 쓴다 (하나라도 막히면 아무것도 쓰지 않는다). 막히면 기다릴 ms, 통과하면 0 */
export function takeAll(checks: LimitCheck[], now = Date.now()): { waitMs: number; blockedBy?: string } {
  let waitMs = 0;
  let blockedBy: string | undefined;
  for (const { limiter, key } of checks) {
    const wait = limiter.waitMs(key, now);
    if (wait > waitMs) {
      waitMs = wait;
      blockedBy = limiter.name;
    }
  }
  if (waitMs > 0) return { waitMs, blockedBy };
  for (const { limiter, key } of checks) limiter.consume(key, now);
  return { waitMs: 0 };
}
