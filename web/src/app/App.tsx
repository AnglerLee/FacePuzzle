// 화면 전환: /facepuzzle/ (슬롯), /facepuzzle/draw (그리기), /facepuzzle/album (앨범).
// pushState 를 써서 안드로이드 뒤로가기가 앱을 끄지 않고 이전 화면으로 돌아가게 한다.
// (AnglerBox 는 확장자 없는 하위 주소를 index.html 로 돌려준다)
import { useEffect, useState } from "react";
import { AlbumScreen } from "../album/AlbumScreen";
import { DrawScreen } from "../draw/DrawScreen";
import { SlotScreen } from "../slot/SlotScreen";
import { useData } from "./data";

export type Screen = "slot" | "draw" | "album";

const BASE = import.meta.env.BASE_URL; // "/facepuzzle/"

function screenFromPath(path: string): Screen {
  const rest = path.startsWith(BASE) ? path.slice(BASE.length) : "";
  if (rest.startsWith("draw")) return "draw";
  if (rest.startsWith("album")) return "album";
  return "slot";
}

const pathFor = (s: Screen) => (s === "slot" ? BASE : `${BASE}${s}`);

export function App() {
  const [screen, setScreen] = useState<Screen>(() => screenFromPath(window.location.pathname));
  const { loadError, state, refresh } = useData();

  useEffect(() => {
    const onPop = () => setScreen(screenFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function go(next: Screen) {
    if (next === screen) return;
    window.history.pushState(null, "", pathFor(next));
    setScreen(next);
    window.scrollTo(0, 0);
  }

  return (
    <div className="app">
      {loadError && !state ? (
        <div className="load-error">
          <p className="empty-face" aria-hidden>
            😵
          </p>
          <p>얼굴 그림을 불러오지 못했어요.</p>
          <button type="button" className="primary-btn" onClick={() => void refresh()}>
            다시 해 보기
          </button>
        </div>
      ) : screen === "draw" ? (
        <DrawScreen go={go} />
      ) : screen === "album" ? (
        <AlbumScreen go={go} />
      ) : (
        <SlotScreen go={go} />
      )}
    </div>
  );
}
