import { RateLimiter, takeAll } from "../_server/rate-limit";

describe("RateLimiter", () => {
  it("burst 만큼 쓰고, 시간이 지나면 다시 찬다", () => {
    const l = new RateLimiter("t", { burst: 3, windowMs: 3000 });
    for (let i = 0; i < 3; i++) {
      expect(l.waitMs("ip", 0)).toBe(0);
      l.consume("ip", 0);
    }
    expect(l.waitMs("ip", 0)).toBe(1000);
    expect(l.waitMs("ip", 1000)).toBe(0);
    expect(l.waitMs("other", 0)).toBe(0);
  });

  it("키 수는 maxKeys 를 넘지 않는다 (위조 IP 로 메모리를 채우지 못한다)", () => {
    const l = new RateLimiter("t", { burst: 1, windowMs: 1000 }, 100);
    for (let i = 0; i < 1000; i++) l.consume(`ip${i}`, 0);
    expect(l.size).toBe(100);
  });

  it("가득 찬 버킷은 정리된다", () => {
    const l = new RateLimiter("t", { burst: 2, windowMs: 1000 });
    l.consume("a", 0);
    l.sweep(5000);
    expect(l.size).toBe(0);
  });
});

describe("takeAll", () => {
  it("하나라도 막히면 아무것도 쓰지 않는다", () => {
    const ip = new RateLimiter("ip", { burst: 5, windowMs: 1000 });
    const global = new RateLimiter("global", { burst: 1, windowMs: 1000 });
    expect(takeAll([{ limiter: ip, key: "a" }, { limiter: global, key: "*" }], 0).waitMs).toBe(0);
    const blocked = takeAll([{ limiter: ip, key: "a" }, { limiter: global, key: "*" }], 0);
    expect(blocked.waitMs).toBeGreaterThan(0);
    expect(blocked.blockedBy).toBe("global");
    // ip 버킷은 첫 번째 요청 1개만 썼다
    for (let i = 0; i < 4; i++) {
      expect(ip.waitMs("a", 0)).toBe(0);
      ip.consume("a", 0);
    }
    expect(ip.waitMs("a", 0)).toBeGreaterThan(0);
  });
});
