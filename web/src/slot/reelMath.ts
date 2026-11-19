// 릴 움직임 계산 (순수 함수 — 테스트한다).
// offset 은 "몇 번째 그림을 보고 있는지"를 실수로 나타낸다. 정수일 때 그 그림이 창에 꼭 맞는다.

/** 최고 속도: 초당 지나가는 그림 수 */
export const MAX_SPEED = 12;
/** 출발해서 최고 속도까지 걸리는 시간 */
export const SPIN_UP_MS = 350;
/** 멈출 때 걸리는 최소 시간 */
export const MIN_STOP_MS = 700;

const C1 = 1.2;
const C3 = C1 + 1;
/** easeOutBack 의 출발 기울기 f'(0) — 멈추기 시작할 때 속도가 끊기지 않게 맞춘다 */
export const STOP_SLOPE = 3 * C3 - 2 * C1;

/** 살짝 지나쳤다가 돌아오는 감속 곡선 */
export function easeOutBack(u: number): number {
  const t = u - 1;
  return 1 + C3 * t * t * t + C1 * t * t;
}

export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** 출발 가속: 0 → MAX_SPEED */
export function spinSpeed(elapsedMs: number): number {
  const u = Math.min(1, Math.max(0, elapsedMs / SPIN_UP_MS));
  return MAX_SPEED * u * u;
}

export interface StopPlan {
  target: number;
  durationMs: number;
}

/**
 * 지금 위치·속도에서 멈출 칸과 시간을 정한다. 멈출 칸은 "지금 지나가는 다음 칸들" 중에서 정해지므로
 * 누르는 순간이 결과를 바꾼다(슬롯머신 손맛). 직전 결과와 같은 그림이면 한 칸 더 간다.
 */
export function planStop(offset: number, speed: number, refs: string[], avoidRef: string | null): StopPlan {
  const perMs = Math.max(speed, 4) / 1000;
  let target = Math.ceil(offset + (perMs * MIN_STOP_MS) / STOP_SLOPE);
  const n = refs.length;
  if (n > 1 && avoidRef && refs[mod(target, n)] === avoidRef) target += 1;
  return { target, durationMs: (STOP_SLOPE * (target - offset)) / perMs };
}
