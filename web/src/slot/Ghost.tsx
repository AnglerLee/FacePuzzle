// 아직 안 돌린 부위의 빈자리: 점선 윤곽만 흐리게 보여 준다 (맨 얼굴). 짝 부위는 양쪽에.
import { imageBox, type PartDef } from "@shared/parts";

export function Ghost({ part }: { part: PartDef }) {
  const box = imageBox(part);
  const groups = part.symmetry === "pair" ? ["", `translate(${box.w},0) scale(-1,1)`] : [""];
  return (
    <svg className="ghost" viewBox={`0 0 ${box.w} ${box.h}`} preserveAspectRatio="none" aria-hidden>
      {groups.map((t) => (
        <g key={t} transform={t || undefined}>
          {part.guide.map((d, i) => (
            <path key={i} d={d} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      ))}
    </svg>
  );
}
