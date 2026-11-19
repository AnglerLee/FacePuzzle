// 🌈 색 고르기 창: 무지개 판(누르거나 문질러서 아무 색이나) + 회색 막대 + 내가 만든 색(최근) + 크레용.
// 판에서 고른 색은 미리보기 동그라미에 보이고, [✔ 이 색으로]를 누르면 그 색으로 그린다. 크레용은 누르면 바로.
import { useState, type PointerEvent } from "react";
import { sfx } from "../lib/sound";
import { Sheet } from "../ui/Sheet";
import { CRAYONS, grayColor, pushRecent, readRecent, spectrumColor } from "./colors";

interface Props {
  color: string;
  onPick: (color: string) => void;
  onClose: () => void;
}

type Mark = { kind: "board"; x: number; y: number } | { kind: "gray"; x: number };

const ratio = (e: PointerEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  };
};

export function ColorSheet({ color, onPick, onClose }: Props) {
  const [draft, setDraft] = useState(color);
  const [mark, setMark] = useState<Mark | null>(null);
  const [recent] = useState(readRecent);

  function pickBoard(e: PointerEvent<HTMLElement>) {
    const { x, y } = ratio(e);
    setMark({ kind: "board", x, y });
    setDraft(spectrumColor(x, y));
  }

  function pickGray(e: PointerEvent<HTMLElement>) {
    const { x } = ratio(e);
    setMark({ kind: "gray", x });
    setDraft(grayColor(x));
  }

  /** 누르는 동안 손가락을 따라 색이 바뀐다 */
  const drag = (pick: (e: PointerEvent<HTMLElement>) => void) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      pick(e);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e);
    },
    onPointerUp: () => sfx.pop(),
  });

  function use(c: string, fromPalette: boolean) {
    if (fromPalette) pushRecent(c);
    onPick(c);
    onClose();
  }

  return (
    <Sheet title="색 고르기" onClose={onClose}>
      <div className="color-sheet">
        <div className="spectrum" {...drag(pickBoard)} aria-label="무지개 판에서 색 고르기">
          {mark?.kind === "board" && (
            <span className="color-mark" style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%`, background: draft }} />
          )}
        </div>
        <div className="graybar" {...drag(pickGray)} aria-label="흰색부터 검은색까지">
          {mark?.kind === "gray" && <span className="color-mark" style={{ left: `${mark.x * 100}%`, top: "50%", background: draft }} />}
        </div>
        <div className="color-use">
          <span className="color-preview" style={{ background: draft }} aria-hidden />
          <button type="button" className="primary-btn" onClick={() => use(draft, true)}>
            ✔ 이 색으로 그리기
          </button>
        </div>

        {recent.length > 0 && (
          <>
            <p className="color-label">내가 만든 색</p>
            <div className="color-grid-row">
              {recent.map((c) => (
                <button
                  type="button"
                  key={c}
                  aria-label={c}
                  className={`crayon ${color === c ? "on" : ""}`}
                  style={{ background: c }}
                  onClick={() => use(c, true)}
                />
              ))}
            </div>
          </>
        )}
        <p className="color-label">크레용</p>
        <div className="color-grid-row">
          {CRAYONS.map((c) => (
            <button
              type="button"
              key={c}
              aria-label={c}
              className={`crayon ${color === c ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => use(c, false)}
            />
          ))}
        </div>
      </div>
    </Sheet>
  );
}
