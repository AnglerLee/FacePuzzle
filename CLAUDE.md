# FacePuzzle (뒤죽박죽 얼굴 슬롯)

`web/`(Vite + React 정적 앱, base `/facepuzzle/`) + `server/`(Hono, AnglerBox runner 가 실행하는 번들) + `shared/`(둘이 같이 쓰는 코드). README·docs/development.md 참고.

- `web/vite.config.ts`의 `base`와 API 경로(`/api/facepuzzle`)는 바꾸지 말 것 — 공개 주소·저장된 데이터가 묶여 있다
- 서버 진입점은 `server/src/app.ts`의 default export(Hono app). 포트를 열거나 process.exit 하지 말 것
- 영속 데이터는 `DATA_DIR/facepuzzle/` 아래에만 쓴다 (AnglerBox 의 다른 앱 서버와 볼륨을 같이 쓴다)
- 키 없이 열린 API 다. 새 쓰기 라우트는 반드시 `assertSameOrigin` → `assertRate` → (본문은 `readBodyLimited`/`readJsonLimited`) 를 거치고, 상한값은 `shared/limits.ts` 에 둔다
- 지우기는 숨김(`hiddenAt`)이다. 실제 삭제는 store 의 정리(30일)만 한다
- 그림 PNG 크기 = `shared/parts.ts` 의 `imageBox`. 부위 영역을 바꾸면 이미 저장된 그림과 크기가 어긋나므로 바꾸지 말고 새 부위로 추가한다
- localStorage 키는 `facepuzzle:` 접두사 (`web/src/lib/prefs.ts`)
- 화면·서버가 같이 쓰는 타입·검증은 `shared/`에 두고 `@shared/...`로 import 한다. `shared/` 안에서는 상대경로로 import 한다
- 검사: `npm test && npm run lint && npm run build` (루트). server 는 `npm --prefix server run typecheck`도
- lockfile 은 Node 22(npm 10)의 `npm ci`가 받아들여야 한다 (CI 가 Node 22)
