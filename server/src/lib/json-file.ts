import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** DATA_DIR(컨테이너 /data/app-data, 로컬 기본 ./data) 아래 경로. 호출할 때마다 환경 변수를 읽는다(테스트용) */
export function dataDir(...parts: string[]): string {
  const root = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data");
  return path.join(root, ...parts);
}

/**
 * 같은 폴더의 임시 파일에 쓴 뒤 rename — 쓰는 도중 꺼져도 기존 파일이 반쯤 덮이지 않는다.
 * (toys/server/src/lib/json-file.ts 와 같은 코드에 바이너리 내용만 더 받는다)
 */
export async function writeFileAtomic(
  file: string,
  content: string | Uint8Array,
  { mode = 0o600 }: { mode?: number } = {},
): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await fs.writeFile(tmp, content, { mode });
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}
