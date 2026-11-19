// FacePuzzle(뒤죽박죽 얼굴 슬롯) 서버. 운영에서는 AnglerBox runner 가 이 app 을 불러와 실행하고,
// 같은 도메인의 /api/facepuzzle 요청을 받는다. 로컬에서는 src/dev.ts 로 띄운다.
// 키 없이 열린 저장소라서 모든 쓰기는 _server/guard.ts 의 방어 계층(출처·크기·속도·동시성)과
// _server/store.ts 의 할당량을 거친다.
import { Hono } from "hono";
import * as album from "./routes/album";
import * as authors from "./routes/authors";
import * as drawings from "./routes/drawings";
import { handle } from "./routes/handle";
import * as state from "./routes/state";

const app = new Hono().basePath("/api/facepuzzle");

app.get("/state", (c) => handle(() => state.GET(c.req.raw)));

app.post("/drawings", (c) => handle(() => drawings.POST(c.req.raw)));
app.get("/drawings/:file", (c) => handle(() => drawings.GET_IMAGE(c.req.raw, c.req.param("file"))));
app.delete("/drawings/:id", (c) => handle(() => drawings.DELETE(c.req.raw, c.req.param("id"))));
app.post("/drawings/:id/restore", (c) => handle(() => drawings.RESTORE(c.req.raw, c.req.param("id"))));

app.post("/authors", (c) => handle(() => authors.POST(c.req.raw)));
app.patch("/authors/:id", (c) => handle(() => authors.PATCH(c.req.raw, c.req.param("id"))));
app.delete("/authors/:id", (c) => handle(() => authors.DELETE(c.req.raw, c.req.param("id"))));
app.post("/authors/:id/restore", (c) => handle(() => authors.RESTORE(c.req.raw, c.req.param("id"))));

app.post("/album", (c) => handle(() => album.POST(c.req.raw)));
app.patch("/album/:id", (c) => handle(() => album.PATCH(c.req.raw, c.req.param("id"))));
app.delete("/album/:id", (c) => handle(() => album.DELETE(c.req.raw, c.req.param("id"))));
app.post("/album/:id/restore", (c) => handle(() => album.RESTORE(c.req.raw, c.req.param("id"))));

app.notFound(() => Response.json({ error: "not_found", message: "없는 주소예요" }, { status: 404 }));

export default app;
