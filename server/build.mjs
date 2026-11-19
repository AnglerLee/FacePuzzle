// 서버를 AnglerBox runner 가 불러올 번들 하나로 만든다 (apps-host 와 같은 번들 계약): dist/server.mjs + dist/manifest.json (+ 함께 둘 파일)
// 의존성(hono 등)까지 모두 묶어서, NAS 에는 이 폴더만 올리면 된다 (Docker 빌드 없음).
import { build } from "esbuild";
import { cpSync, rmSync } from "node:fs";

/** 번들 옆에 함께 올릴 파일: [원본, dist 안 경로] */
const EXTRA_FILES = [];

rmSync("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/app.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // CommonJS 의존성이 require 를 쓰는 경우를 위해
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "info",
});
cpSync("manifest.json", "dist/manifest.json");
for (const [from, to] of EXTRA_FILES) cpSync(from, `dist/${to}`, { recursive: true });
