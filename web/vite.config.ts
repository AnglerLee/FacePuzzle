/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// AnglerBox 가 빌드해 /facepuzzle/ 에 게시한다. 하위 경로에서도 에셋이 깨지지 않도록 절대 base 를 쓴다.
export default defineConfig({
  base: "/facepuzzle/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) },
  },
  // 로컬 개발·미리보기: /api 는 이 레포의 server(npm run dev, :8080)로 넘긴다.
  // 운영에서는 AnglerBox 가 같은 도메인의 /api/facepuzzle 을 앱 서버(runner)로 넘긴다.
  server: {
    fs: { allow: [".."] },
    proxy: { "/api": process.env.API_PROXY_TARGET ?? "http://localhost:8080" },
  },
  preview: {
    proxy: { "/api": process.env.API_PROXY_TARGET ?? "http://localhost:8080" },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
