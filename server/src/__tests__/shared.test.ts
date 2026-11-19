import { findJackpot } from "@shared/jackpot";
import { randomName } from "@shared/names";
import { activeParts, getPart, hitBoxes, imageBox, PARTS, PARTS_BY_STOP } from "@shared/parts";
import { readPngHeader } from "@shared/png";
import { cleanText, parseAlbumInput, parseAuthorInput } from "@shared/types";
import { makePng } from "../test/png";

describe("parts", () => {
  it("짝 부위의 PNG 영역은 왼쪽 영역부터 거울 위치까지다", () => {
    const eyes = getPart("eyes");
    expect(imageBox(eyes)).toEqual({ x: 190, y: 350, w: 620, h: 260 });
    expect(hitBoxes(eyes)[1]).toEqual({ x: 520, y: 350, w: 290, h: 260 });
  });

  it("거울 붓 부위는 얼굴 가운데(x=500)를 기준으로 놓인다", () => {
    for (const part of PARTS.filter((p) => p.symmetry === "mirror")) {
      expect(part.draw.x + part.draw.w / 2).toBe(500);
    }
  });

  it("모든 영역이 얼굴 안에 있다", () => {
    for (const part of PARTS) {
      const box = imageBox(part);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(1000);
      expect(box.y + box.h).toBeLessThanOrEqual(1000);
    }
  });

  it("기본 단계는 눈·코·입만 돈다", () => {
    expect(activeParts("basic").map((p) => p.id)).toEqual(["eyes", "nose", "mouth"]);
    expect(activeParts("advanced")).toHaveLength(7);
    expect(PARTS_BY_STOP[0].id).toBe("hair");
  });
});

describe("png", () => {
  it("크기와 색 형식을 읽는다", () => {
    expect(readPngHeader(makePng(290, 200))).toEqual({ width: 290, height: 200, bitDepth: 8, colorType: 6 });
  });

  it("PNG 가 아니거나 잘렸으면 null", () => {
    const png = makePng(10, 10);
    expect(readPngHeader(new TextEncoder().encode("<svg onload=alert(1)>".padEnd(80, " ")))).toBeNull();
    expect(readPngHeader(png.slice(0, png.length - 4))).toBeNull();
    const appended = new Uint8Array(png.length + 10);
    appended.set(png);
    expect(readPngHeader(appended)).toBeNull();
  });
});

describe("입력 검증", () => {
  it("보이지 않는 문자를 지우고 길이를 자른다", () => {
    expect(cleanText("  엄​마‮  ", 12)).toBe("엄마");
    expect(cleanText("가".repeat(30), 12)).toHaveLength(12);
    expect(cleanText("   ", 12)).toBeNull();
    expect(cleanText(42, 12)).toBeNull();
  });

  it("작가는 정해진 이모지·색만 받는다", () => {
    expect(parseAuthorInput({ name: "할머니", emoji: "👵", color: "#3a86ff" })).toEqual({
      name: "할머니",
      emoji: "👵",
      color: "#3a86ff",
    });
    expect(parseAuthorInput({ name: "x", emoji: "<b>", color: "#3a86ff" })).toBeNull();
    expect(parseAuthorInput({ name: "x", emoji: "👵", color: "red" })).toBeNull();
    expect(parseAuthorInput({ name: "새 이름" }, true)).toEqual({ name: "새 이름" });
    expect(parseAuthorInput({}, true)).toBeNull();
  });

  it("앨범은 부위 id 와 그림 참조만 받는다", () => {
    expect(parseAlbumInput({ name: "웃는 감자", parts: { eyes: "0123456789abcdef", nose: "sample-1" } })).not.toBeNull();
    expect(parseAlbumInput({ name: "x", parts: { tail: "sample-1" } })).toBeNull();
    expect(parseAlbumInput({ name: "x", parts: { eyes: "../../etc/passwd" } })).toBeNull();
    expect(parseAlbumInput({ name: "x", parts: {} })).toBeNull();
  });
});

describe("이름과 잭팟", () => {
  it("별명은 형용사 + 이름", () => {
    expect(randomName(() => 0)).toBe("뽀글뽀글 왕눈이");
  });

  it("작가가 2명 이상이고 3부위가 모두 같은 작가면 잭팟", () => {
    const two = new Set(["a", "b"]);
    const same = [{ authorId: "a" }, { authorId: "a" }, { authorId: "a" }];
    expect(findJackpot(same, two)).toBe("a");
    expect(findJackpot(same, new Set(["a"]))).toBeNull();
    expect(findJackpot([{ authorId: "a" }, { authorId: "b" }, { authorId: "a" }], two)).toBeNull();
    expect(findJackpot([{ authorId: null }, { authorId: null }, { authorId: null }], two)).toBeNull();
    expect(findJackpot(same.slice(0, 2), two)).toBeNull();
  });
});
