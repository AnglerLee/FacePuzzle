// 옆으로 넘기는 줄(슬롯 썸네일, 그린 그림 줄)을 마우스로도 끌어서 넘기게 한다.
// 터치는 브라우저가 알아서 밀어 주므로 마우스일 때만 처리한다. 끌고 난 뒤 따라오는 click 은 막는다(돌리기·고르기 방지).
import type { MouseEvent, PointerEvent } from "react";

const DRAG_PX = 6;

export function dragScroll() {
  let el: HTMLElement | null = null;
  let startX = 0;
  let startLeft = 0;
  let moved = false;
  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      moved = false;
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      el = e.currentTarget;
      startX = e.clientX;
      startLeft = el.scrollLeft;
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      if (!el || e.pointerType !== "mouse") return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > DRAG_PX) {
        moved = true;
        el.setPointerCapture(e.pointerId);
      }
      if (moved) el.scrollLeft = startLeft - dx;
    },
    onPointerUp() {
      el = null;
    },
    onPointerCancel() {
      el = null;
    },
    onClickCapture(e: MouseEvent<HTMLElement>) {
      if (!moved) return;
      moved = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };
}
