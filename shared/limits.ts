// 키 없이 열려 있는 저장소라서 과도한 입력을 막는 상한값을 한 곳에 모았다.
// 서버(server/src/_server/guard.ts·store.ts)가 이 값으로 막고, 화면은 안내 문구에 쓴다.

export const LIMITS = {
  /** 그림 PNG 한 장 최대 크기 */
  pngMaxBytes: 400 * 1024,
  /** JSON 요청 본문 최대 크기 */
  jsonMaxBytes: 8 * 1024,
  /** 요청 본문을 다 받기까지 기다리는 시간 */
  bodyTimeoutMs: 15_000,
  /** 동시에 받는 업로드 수 */
  maxConcurrentUploads: 3,
  /** 부위별로 보이는(숨기지 않은) 그림 수 */
  perPartActive: 150,
  /** 숨긴 그림까지 포함한 전체 그림 파일 수 */
  totalDrawingFiles: 1500,
  /** 전체 그림 용량 */
  totalBytes: 250 * 1024 * 1024,
  /** 앨범 항목 수 (숨긴 항목 포함) */
  albumMax: 300,
  /** 가족 작가 수 (숨긴 작가 포함) */
  authorsMax: 12,
  authorNameMax: 12,
  albumNameMax: 24,
  /** 숨긴 항목을 실제로 지우기까지 */
  trashDays: 30,
} as const;

export interface BucketRule {
  /** 한 번에 쓸 수 있는 최대 횟수 */
  burst: number;
  /** 다시 차는 속도: windowMs 동안 burst 만큼 */
  windowMs: number;
}

const MIN = 60_000;
const DAY = 86_400_000;

/** 속도 제한 규칙. ip 는 IP별, global 은 IP와 상관없이 전체에 건다 */
export const RATE = {
  uploadIp: { burst: 10, windowMs: MIN },
  uploadIpDaily: { burst: 300, windowMs: DAY },
  uploadGlobal: { burst: 60, windowMs: MIN },
  uploadGlobalDaily: { burst: 1500, windowMs: DAY },
  albumIp: { burst: 20, windowMs: MIN },
  authorIp: { burst: 5, windowMs: 2.5 * MIN },
  removeIp: { burst: 30, windowMs: MIN },
  /** 한꺼번에 지우기(설정의 초기화)·한꺼번에 되살리기. 한 번에 많이 바꾸므로 따로 적게 둔다 */
  bulkIp: { burst: 5, windowMs: MIN },
  writeGlobal: { burst: 120, windowMs: MIN },
  stateIp: { burst: 30, windowMs: 30_000 },
  imageIp: { burst: 1500, windowMs: MIN },
} as const satisfies Record<string, BucketRule>;

/** 슬롯 한 판에 부위별로 섞어 넣는 그림 수 (미리 불러올 이미지 수를 묶는다) */
export const REEL_WINDOW = 24;
