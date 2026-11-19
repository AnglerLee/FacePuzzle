# 개발

## 구조

| 폴더 | 내용 |
|---|---|
| `shared/` | 부위 정의(`parts.ts`), 상한값(`limits.ts`), 타입·입력 검증(`types.ts`), PNG 머리 검사, 별명, 잭팟 |
| `server/` | Hono 서버. `src/_server/guard.ts`(방어 계층), `src/_server/store.ts`(저장소), `src/routes/*` |
| `web/` | React 화면. `slot/`(릴·슬롯 화면, `layout.ts`는 부위 줄 순서·? 자리·썸네일 줄=릴 항목 계산), `draw/`(캔버스·획·PNG 내보내기), `album/`, `samples/`(예시 SVG) |

## 로컬 실행

```bash
npm run setup   # web·server 의존성 설치
npm run dev     # server :8080 + web :5173 (http://localhost:5173/facepuzzle/)
```

데이터는 `server/data/facepuzzle/` 에 쌓인다 (git 에 안 올라간다).

## 얼굴 좌표

얼굴은 1000×1000 단위. 부위마다 그리는 영역이 정해져 있고, 그림은 그 영역 크기의 투명 PNG(1단위 = 1px)로 저장된다.
짝 부위(눈·귀·눈썹)는 왼쪽 영역부터 x=500 기준 거울 위치까지를 한 장으로 저장한다. 서버는 PNG 크기가 정확히 맞는지 검사한다.

## 저장 형식

- `$DATA_DIR/facepuzzle/index.json` — `{ version, rev, drawings[], authors[], album[], lastGc }`
- `$DATA_DIR/facepuzzle/drawings/<16hex>.png`

모든 쓰기는 한 프로세스 안의 락으로 줄을 세우고 임시 파일 → rename 으로 쓴다.
숨긴 지 30일 지난 항목은 한 시간에 한 번 정리한다(보이는 앨범이 쓰는 그림은 남긴다).

## API (`/api/facepuzzle`)

| 메서드 | 경로 | |
|---|---|---|
| GET | `/state` | 작가·그림·앨범 |
| POST | `/drawings?part=&author=` | 본문 raw `image/png` |
| GET | `/drawings/<id>.png` | immutable 캐시 |
| DELETE / POST | `/drawings/:id`, `/drawings/:id/restore` | 숨기기 / 되살리기 |
| POST, PATCH, DELETE / POST | `/authors`, `/authors/:id`, `/authors/:id/restore` | |
| POST, PATCH, DELETE / POST | `/album`, `/album/:id`, `/album/:id/restore` | |

## 방어 (키 없음)

상한값은 모두 `shared/limits.ts`.

- 쓰기 요청은 같은 출처만 (`Sec-Fetch-Site`/`Origin`). 브라우저가 아닌 요청은 아래 제한이 막는다
- PNG 400KB, JSON 8KB. `Content-Length` 로 먼저 거르고 스트림을 읽으며 다시 끊는다. 15초 안에 다 와야 한다
- PNG 시그니처·IHDR 크기·IEND 확인, 부위 크기와 정확히 같아야 한다
- 토큰 버킷: IP별(`X-Real-IP` → `X-Forwarded-For`)과 전체(IP 무관). 넘으면 429 + `Retry-After`
- 동시 업로드 3개. 넘으면 503
- 할당량: 부위별 150장, 전체 1500장·250MB, 앨범 300, 작가 12. 넘으면 409 `full` (자동으로 지우지 않는다)
- 지우기는 숨김이라 누가 마구 지워도 30일 안에 되살린다

## 배포

AnglerBox 관리자 `/admin/new` 에 GitHub 주소를 넣으면 NAS 가 받아서 빌드·게시한다. 이후 변경은 [업데이트].
배포 뒤 확인할 것: DSM 리버스 프록시가 `X-Real-IP` 를 넣어 주는지 (없으면 IP별 제한 대신 전체 제한이 총량을 묶는다).
