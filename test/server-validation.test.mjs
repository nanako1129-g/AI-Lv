import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.mjs";

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test("POST /api/dars-evaluate: オリジン不一致は403", async () => {
  const app = createApp({
    distDir: "",
    serveSpa: false,
    host: "127.0.0.1",
    port: 0,
    trustProxy: false,
    publicOrigin: "https://example.com",
    logEvalErrors: false,
    apiKey: "dummy-key",
    model: "",
  });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/dars-evaluate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://invalid.example",
      },
      body: JSON.stringify({
        userText: "これは十分な長さのテキストです",
        primaryAxis: "開発者（エンジニア）",
      }),
    });
    assert.equal(res.status, 403);
  });
});

test("POST /api/dars-evaluate: 入力が短い場合は400", async () => {
  const app = createApp({
    distDir: "",
    serveSpa: false,
    host: "127.0.0.1",
    port: 0,
    trustProxy: false,
    publicOrigin: "",
    logEvalErrors: false,
    apiKey: "dummy-key",
    model: "",
  });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/dars-evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userText: "短い",
        primaryAxis: "開発者（エンジニア）",
      }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /短すぎ/);
  });
});

test("POST /api/dars-evaluate: APIキー未設定は503", async () => {
  const app = createApp({
    distDir: "",
    serveSpa: false,
    host: "127.0.0.1",
    port: 0,
    trustProxy: false,
    publicOrigin: "",
    logEvalErrors: false,
    apiKey: "",
    model: "",
  });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/dars-evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userText: "これは十分な長さのテキストです",
        primaryAxis: "開発者（エンジニア）",
      }),
    });
    assert.equal(res.status, 503);
  });
});
