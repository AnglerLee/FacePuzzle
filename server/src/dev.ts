// 로컬 개발용 실행기 — 운영에서는 AnglerBox runner 가 dist/server.mjs 를 불러와 같은 app 을 실행한다.
import { serve } from "@hono/node-server";
import app from "./app";

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`dev server listening on http://localhost:${info.port}`);
});
