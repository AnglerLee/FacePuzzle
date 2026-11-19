// 얼굴 부위 정의. 화면(그리기·슬롯·앨범)과 서버(PNG 크기 검사)가 같이 쓴다.
// 얼굴은 1000×1000 단위 정사각형이고, 그림 PNG 는 1단위 = 1px 로 저장한다.
// 부위를 늘리려면 PARTS 에 한 줄 더 넣으면 된다 (예시 그림은 web/src/samples 에 추가).

export type PartId = "ears" | "face" | "eyes" | "nose" | "mouth" | "brows" | "hair";
export type Level = "basic" | "advanced";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PartDef {
  id: PartId;
  label: string;
  emoji: string;
  level: Level;
  /** 그리는 영역. 짝 부위(pair)는 왼쪽 한쪽 영역이다 */
  draw: Box;
  /**
   * pair: 거울 모드면 한쪽만 그리고 반대쪽은 x=500 기준 거울로 붙는다.
   * mirror: 영역 하나에 그리고, 거울 모드(거울 붓)면 영역 가운데 세로줄 기준으로 같이 그려진다.
   */
  symmetry: "pair" | "mirror";
  /**
   * 짝 부위를 일반 모드(양쪽 따로)로 그릴 때:
   * together: 양쪽이 한 캔버스에 나와 한꺼번에 그린다 (눈·눈썹처럼 양쪽이 가까운 부위)
   * sides: 왼쪽·오른쪽을 번갈아 크게 그린다 (귀처럼 양쪽이 멀리 떨어진 부위)
   */
  pairEdit?: "together" | "sides";
  /** mirror 부위의 거울 모드 기본값 */
  mirrorDefault: boolean;
  /** 아래(0)에서 위로 겹치는 순서 */
  z: number;
  /** [멈춰!]를 눌렀을 때 멈추는 순서 (작을수록 먼저) */
  stopOrder: number;
  /** 가이드 도형: draw 영역 안쪽 좌표의 SVG path */
  guide: string[];
  hint: string;
  /** 짝 부위를 한 캔버스에 양쪽 다 그릴 때 안내 */
  hintBoth?: string;
}

export const FACE_SIZE = 1000;

export const PARTS: readonly PartDef[] = [
  {
    id: "ears",
    label: "귀",
    emoji: "👂",
    level: "advanced",
    draw: { x: 40, y: 390, w: 180, h: 260 },
    symmetry: "pair",
    pairEdit: "sides",
    mirrorDefault: true,
    z: 0,
    stopOrder: 5,
    guide: ["M150,40 C60,10 14,110 36,178 C54,232 118,246 152,214"],
    hint: "한쪽 귀를 그려요",
  },
  {
    id: "face",
    label: "얼굴",
    emoji: "🙂",
    level: "advanced",
    draw: { x: 150, y: 120, w: 700, h: 820 },
    symmetry: "mirror",
    mirrorDefault: true,
    z: 1,
    stopOrder: 6,
    guide: ["M350,24 C590,24 676,240 676,430 C676,650 540,796 350,796 C160,796 24,650 24,430 C24,240 110,24 350,24 Z"],
    hint: "얼굴 모양을 그려요",
  },
  {
    id: "eyes",
    label: "눈",
    emoji: "👀",
    level: "basic",
    draw: { x: 190, y: 350, w: 290, h: 260 },
    symmetry: "pair",
    pairEdit: "together",
    mirrorDefault: true,
    z: 2,
    stopOrder: 2,
    guide: [
      "M40,130 A105,72 0 1,0 250,130 A105,72 0 1,0 40,130 Z",
      "M117,130 A28,28 0 1,0 173,130 A28,28 0 1,0 117,130 Z",
    ],
    hint: "한쪽 눈을 그려요",
    hintBoth: "두 눈을 그려요",
  },
  {
    id: "nose",
    label: "코",
    emoji: "👃",
    level: "basic",
    draw: { x: 390, y: 520, w: 220, h: 200 },
    symmetry: "mirror",
    mirrorDefault: false,
    z: 3,
    stopOrder: 3,
    guide: ["M110,24 C96,80 58,118 60,146 C62,172 92,178 110,166 C128,178 158,172 160,146 C162,118 124,80 110,24 Z"],
    hint: "코를 그려요",
  },
  {
    id: "mouth",
    label: "입",
    emoji: "👄",
    level: "basic",
    draw: { x: 290, y: 690, w: 420, h: 180 },
    symmetry: "mirror",
    mirrorDefault: false,
    z: 4,
    stopOrder: 4,
    guide: ["M60,66 Q210,196 360,66 Q210,112 60,66 Z"],
    hint: "입을 그려요",
  },
  {
    id: "brows",
    label: "눈썹",
    emoji: "〰️",
    level: "advanced",
    draw: { x: 190, y: 290, w: 290, h: 110 },
    symmetry: "pair",
    pairEdit: "together",
    mirrorDefault: true,
    z: 5,
    stopOrder: 1,
    guide: ["M40,78 Q145,14 250,70"],
    hint: "한쪽 눈썹을 그려요",
    hintBoth: "두 눈썹을 그려요",
  },
  {
    id: "hair",
    label: "머리",
    emoji: "💇",
    level: "advanced",
    // 긴 머리가 얼굴 옆으로 어깨까지 내려오도록 얼굴 거의 전체를 덮는다 (맨 위 층)
    draw: { x: 40, y: 20, w: 920, h: 940 },
    symmetry: "mirror",
    mirrorDefault: false,
    z: 6,
    stopOrder: 0,
    guide: [
      "M90,900 C40,700 40,420 110,240 C180,20 740,20 810,240 C880,420 880,700 830,900 C800,760 790,480 745,330 C640,250 280,250 175,330 C130,480 120,760 90,900 Z",
    ],
    hint: "머리카락을 그려요",
  },
];

export const PART_IDS: readonly PartId[] = PARTS.map((p) => p.id);

const BY_ID = new Map(PARTS.map((p) => [p.id, p]));

export function isPartId(value: unknown): value is PartId {
  return typeof value === "string" && BY_ID.has(value as PartId);
}

export function getPart(id: PartId): PartDef {
  const part = BY_ID.get(id);
  if (!part) throw new Error(`unknown part: ${id}`);
  return part;
}

/** 저장되는 PNG 가 차지하는 영역. 짝 부위는 왼쪽 영역부터 거울 위치의 오른쪽 영역까지다 */
export function imageBox(part: PartDef): Box {
  if (part.symmetry !== "pair") return part.draw;
  const { x, y, h } = part.draw;
  return { x, y, w: FACE_SIZE - 2 * x, h };
}

/** 짝 부위의 오른쪽 영역 (x=500 기준 거울 위치) */
export function rightBox(part: PartDef): Box {
  const { x, y, w, h } = part.draw;
  return { x: FACE_SIZE - x - w, y, w, h };
}

/** 슬롯 화면에서 터치로 고를 때 쓰는 영역 (짝 부위는 양쪽 따로) */
export function hitBoxes(part: PartDef): Box[] {
  return part.symmetry === "pair" ? [part.draw, rightBox(part)] : [part.draw];
}

/** 아래에서 위로 그리는 순서 */
export const PARTS_BY_Z: readonly PartDef[] = [...PARTS].sort((a, b) => a.z - b.z);

/** [멈춰!]를 눌렀을 때 멈추는 순서 */
export const PARTS_BY_STOP: readonly PartDef[] = [...PARTS].sort((a, b) => a.stopOrder - b.stopOrder);

/** 이 단계에서 돌아가는 부위 */
export function activeParts(level: Level): PartDef[] {
  return PARTS.filter((p) => level === "advanced" || p.level === "basic");
}
