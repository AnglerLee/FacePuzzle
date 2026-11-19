// 기본 예시 그림. 아이가 아직 아무것도 안 그렸어도 바로 돌려 볼 수 있게 부위마다 몇 개씩 둔다.
// SVG 로 만들어 data URL 로 쓴다. 짝 부위(눈·귀·눈썹)는 왼쪽만 그리고 오른쪽은 거울로 붙인다.
// 그림 영역(shared/parts.ts 의 imageBox)과 같은 크기의 viewBox 를 쓰므로 그린 그림과 똑같이 겹쳐진다.
import { getPart, imageBox, PARTS, type PartId } from "@shared/parts";

const INK = "#3b2a1a";
const SKIN = "#ffd9b8";
const SKIN_DARK = "#f4b98f";
const BLUSH = "#ff9eb0";

const line = (w = 10) =>
  `fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const shape = (fill: string, w = 9) =>
  `fill="${fill}" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

/** 손으로 그린 듯 살짝 떨리는 선 */
const ROUGH = `<filter id="r" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="5"/></filter>`;

/** 부위별 예시: 짝 부위는 왼쪽 그림 영역(draw) 좌표, 나머지는 그림 영역 좌표 */
const LEFT_OR_FULL: Record<PartId, string[]> = {
  eyes: [
    // 동글 눈 + 속눈썹 (기본 얼굴)
    `<g transform="translate(0,30)"><path d="M70,66 L44,40 M98,48 L84,20 M132,40 L128,12" ${line(8)}/><ellipse cx="145" cy="104" rx="90" ry="62" ${shape("#fff")}/><circle cx="152" cy="110" r="32" fill="${INK}"/><circle cx="163" cy="97" r="10" fill="#fff"/></g>`,
    // 동글 눈
    `<g transform="translate(0,30)"><ellipse cx="145" cy="100" rx="92" ry="64" ${shape("#fff")}/><circle cx="152" cy="106" r="32" fill="${INK}"/><circle cx="163" cy="93" r="10" fill="#fff"/></g>`,
    // 점 눈 + 눈두덩
    `<g transform="translate(0,30)"><circle cx="145" cy="112" r="24" fill="${INK}"/><path d="M92,72 Q145,38 198,72" ${line(9)}/></g>`,
    // 졸린 눈
    `<g transform="translate(0,30)"><path d="M66,96 Q145,150 224,96" ${line(11)}/><path d="M96,122 L84,146 M145,134 L145,160 M194,122 L206,146" ${line(8)}/></g>`,
    // 반짝 별 눈
    `<g transform="translate(0,30)"><path d="M145,28 L166,78 L220,82 L178,116 L192,170 L145,140 L98,170 L112,116 L70,82 L124,78 Z" ${shape("#ffd23f", 8)}/></g>`,
  ],
  nose: [
    `<circle cx="110" cy="122" r="36" ${shape("#ffb3a7")}/><circle cx="98" cy="110" r="8" fill="#fff" opacity=".8"/>`,
    `<path d="M112,36 L72,150 Q112,168 152,150" ${line(10)}/>`,
    `<ellipse cx="110" cy="118" rx="62" ry="44" ${shape("#ffb6c8")}/><ellipse cx="88" cy="118" rx="11" ry="17" fill="${INK}"/><ellipse cx="132" cy="118" rx="11" ry="17" fill="${INK}"/>`,
  ],
  mouth: [
    // 분홍 미소 (기본 얼굴)
    `<path d="M110,64 Q210,170 310,64 Q210,104 110,64 Z" ${shape("#ff6f8e", 9)}/>`,
    `<path d="M70,62 Q210,168 350,62" ${line(12)}/>`,
    `<path d="M78,48 Q210,40 342,48 Q302,168 210,168 Q118,168 78,48 Z" ${shape("#b4233c")}/><path d="M96,52 Q210,46 324,52 L314,78 Q210,72 106,78 Z" fill="#fff"/><ellipse cx="210" cy="140" rx="52" ry="22" fill="#ff7a93"/>`,
    `<ellipse cx="210" cy="92" rx="46" ry="58" ${shape("#b4233c")}/>`,
    `<path d="M66,92 Q113,52 160,92 T254,92 T348,92" ${line(11)}/>`,
  ],
  brows: [
    `<path d="M52,78 Q145,18 244,68" ${line(16)}/>`,
    `<path d="M58,36 L238,84" ${line(18)}/>`,
    `<path d="M48,74 L70,44 L92,72 L114,40 L136,70 L158,38 L180,68 L202,40 L224,66 L246,44" ${line(13)}/>`,
  ],
  ears: [
    `<path d="M150,52 C62,18 12,112 40,182 C60,232 122,242 152,210 Z" ${shape(SKIN)}/><path d="M120,92 C82,92 74,150 114,170" ${line(8)}/>`,
    `<path d="M156,66 L16,18 C36,118 72,198 156,212 Z" ${shape(SKIN)}/><path d="M128,84 L64,64 C76,120 96,160 128,176" ${line(7)}/>`,
    `<circle cx="96" cy="132" r="80" ${shape(SKIN)}/><circle cx="96" cy="132" r="46" fill="${BLUSH}" opacity=".75"/>`,
  ],
  face: [
    // 달걀 얼굴 + 볼터치
    `<path d="M350,26 C590,26 674,240 674,430 C674,650 540,794 350,794 C160,794 26,650 26,430 C26,240 110,26 350,26 Z" ${shape(SKIN, 11)}/><ellipse cx="150" cy="590" rx="62" ry="38" fill="${BLUSH}" opacity=".7"/><ellipse cx="550" cy="590" rx="62" ry="38" fill="${BLUSH}" opacity=".7"/>`,
    // 동그란 얼굴
    `<ellipse cx="350" cy="440" rx="330" ry="350" ${shape("#ffe2c6", 11)}/><circle cx="160" cy="600" r="44" fill="${BLUSH}" opacity=".6"/><circle cx="540" cy="600" r="44" fill="${BLUSH}" opacity=".6"/>`,
    // 네모 얼굴
    `<rect x="44" y="70" width="612" height="716" rx="150" ${shape(SKIN_DARK, 11)}/>`,
  ],
  hair: [
    // 긴 생머리 (기본 얼굴): 앞머리 + 얼굴 양옆으로 어깨까지
    `<path d="M90,900 C40,700 40,420 110,240 C180,0 740,0 810,240 C880,420 880,700 830,900 Q790,928 750,900 C762,700 770,480 745,330 Q700,280 640,240 Q580,300 520,250 Q460,300 400,250 Q340,300 280,240 Q220,280 175,330 C150,480 158,700 170,900 Q130,928 90,900 Z" ${shape("#6b3e26", 10)}/><path d="M300,120 Q380,70 470,80" ${line(7)} opacity=".35"/>`,
    // 단발 보브
    `<path d="M80,650 C40,480 40,360 110,240 C180,0 740,0 810,240 C880,360 880,480 840,650 Q795,668 750,650 C766,520 766,420 745,330 C650,300 640,250 600,236 C520,280 400,280 320,236 C280,250 270,300 175,330 C154,420 154,520 170,650 Q125,668 80,650 Z" ${shape("#2f2a2a", 10)}/>`,
    // 양쪽 똥머리
    `<g transform="translate(40,0)"><circle cx="110" cy="150" r="92" ${shape("#c0582b", 10)}/><circle cx="730" cy="150" r="92" ${shape("#c0582b", 10)}/><path d="M80,430 C50,210 210,70 420,70 C630,70 790,210 760,430 C720,300 590,236 420,236 C250,236 120,300 80,430 Z" ${shape("#c0582b", 10)}/></g>`,
    // 뽀글 머리 (아래 curlyHair 로 채운다)
    "",
    // 짧은 머리
    `<g transform="translate(40,0)"><path d="M70,440 C40,200 200,40 420,40 C640,40 800,200 770,440 C740,330 680,250 560,232 C520,270 470,278 420,250 C350,280 280,268 250,226 C150,246 92,330 70,440 Z" ${shape("#5b3a1e", 10)}/></g>`,
    // 삐죽 머리
    `<g transform="translate(40,0)"><path d="M80,430 L100,250 L40,230 L150,170 L120,70 L250,120 L300,20 L380,110 L450,10 L500,110 L590,30 L610,130 L730,90 L700,190 L800,220 L740,270 L760,430 C700,280 560,226 420,226 C280,226 140,280 80,430 Z" ${shape("#2c2c2c", 9)}/></g>`,
  ],
};

/** 뽀글 머리: 머리 둘레를 따라 동그라미를 늘어놓는다 */
function curlyHair(): string {
  const circles: string[] = [];
  const cx = 420;
  const cy = 330;
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI + (Math.PI * i) / 16;
    const rx = 330;
    const ry = 270;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    const r = 58 + ((i * 7) % 3) * 8;
    circles.push(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r}"/>`);
  }
  return `<g transform="translate(40,0)" ${shape("#8b4513", 9)}>${circles.join("")}<path d="M110,420 C120,250 260,120 420,120 C580,120 720,250 730,420 C680,300 560,250 420,250 C280,250 160,300 110,420 Z"/></g>`;
}
LEFT_OR_FULL.hair[3] = curlyHair();

function buildSvg(part: PartId, inner: string): string {
  const def = getPart(part);
  const box = imageBox(def);
  const body =
    def.symmetry === "pair"
      ? `<g>${inner}</g><g transform="translate(${box.w},0) scale(-1,1)">${inner}</g>`
      : inner;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}" viewBox="0 0 ${box.w} ${box.h}"><defs>${ROUGH}</defs><g filter="url(#r)">${body}</g></svg>`;
}

const toDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export const SAMPLES: Record<PartId, string[]> = Object.fromEntries(
  PARTS.map((p) => [p.id, LEFT_OR_FULL[p.id].map((inner) => toDataUrl(buildSvg(p.id, inner)))]),
) as Record<PartId, string[]>;

export const sampleRef = (index: number) => `sample-${index}`;

export function sampleSrc(part: PartId, ref: string): string | null {
  const m = /^sample-(\d+)$/.exec(ref);
  if (!m) return null;
  return SAMPLES[part][Number(m[1])] ?? null;
}
