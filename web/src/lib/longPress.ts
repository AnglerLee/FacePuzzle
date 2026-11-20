// 길게 누르기: 손가락(마우스)을 대고 가만히 LONG_MS 동안 있으면 onLong 을 부른다. 움직이거나(줄 밀기) 떼면 취소.
// 길게 누르고 뗄 때 따라오는 click 은 consumeClick() 으로 한 번 걸러 낸다 (돌리기 방지).
// 브라우저가 click 을 안 보내는 경우도 있어서, 다음에 누를 때 그 표시를 지운다.
import type { PointerEvent } from "react";

const LONG_MS = 550;
const MOVE_PX = 10;

export function longPress() {
  let timer = 0;
  let x = 0;
  let y = 0;
  let fired = false;
  const cancel = () => {
    window.clearTimeout(timer);
    timer = 0;
  };
  return {
    /** onLong 이 false 를 돌려주면 길게 누른 것으로 치지 않는다 (뒤따르는 click 을 그대로 둔다) */
    start(e: PointerEvent<HTMLElement>, onLong: () => boolean | void) {
      cancel();
      fired = false;
      if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      x = e.clientX;
      y = e.clientY;
      timer = window.setTimeout(() => {
        timer = 0;
        fired = onLong() !== false;
      }, LONG_MS);
    },
    move(e: PointerEvent<HTMLElement>) {
      if (timer && Math.hypot(e.clientX - x, e.clientY - y) > MOVE_PX) cancel();
    },
    end: cancel,
    /** 방금 길게 누른 뒤 따라온 click 이면 true (한 번만) */
    consumeClick(): boolean {
      if (!fired) return false;
      fired = false;
      return true;
    },
  };
}
