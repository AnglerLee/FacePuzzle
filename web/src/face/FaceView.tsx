// 멈춰 있는 얼굴 하나를 그린다 (앨범·미리보기). 부위 그림을 imageBox 위치에 z 순서대로 겹친다.
import { imageBox, PARTS_BY_Z, type PartId } from "@shared/parts";
import type { CSSProperties } from "react";

export function boxStyle(part: PartId): CSSProperties {
  const def = PARTS_BY_Z.find((p) => p.id === part)!;
  const b = imageBox(def);
  return {
    left: `${b.x / 10}%`,
    top: `${b.y / 10}%`,
    width: `${b.w / 10}%`,
    height: `${b.h / 10}%`,
    zIndex: def.z + 1,
  };
}

interface Props {
  srcs: Partial<Record<PartId, string>>;
  className?: string;
  /** 지금 그리는 부위처럼 강조할 부위 */
  dimOthers?: PartId;
}

export function FaceView({ srcs, className = "", dimOthers }: Props) {
  return (
    <div className={`face-view ${className}`}>
      {PARTS_BY_Z.map((p) => {
        const src = srcs[p.id];
        if (!src) return null;
        return (
          <img
            key={p.id}
            src={src}
            alt=""
            draggable={false}
            className="face-layer"
            style={{ ...boxStyle(p.id), opacity: dimOthers && dimOthers !== p.id ? 0.45 : 1 }}
          />
        );
      })}
    </div>
  );
}
