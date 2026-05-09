import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicOriginAllowsRequest } from "../shared/originGuard.mjs";

test("PUBLIC_ORIGIN 未設定なら常に許可", () => {
  assert.equal(assertPublicOriginAllowsRequest(undefined, {}), true);
});

test("Origin が一致すれば許可", () => {
  assert.equal(
    assertPublicOriginAllowsRequest("https://ai-lv.vercel.app", {
      origin: "https://ai-lv.vercel.app",
      host: "ai-lv.vercel.app",
    }),
    true
  );
});

test("Origin なしで Host が PUBLIC_ORIGIN の host と一致すれば許可（同一オリジン由来）", () => {
  assert.equal(
    assertPublicOriginAllowsRequest("https://ai-lv.vercel.app", {
      origin: "",
      host: "ai-lv.vercel.app",
    }),
    true
  );
});

test("ポート付きでも Host が一致すれば許可", () => {
  assert.equal(
    assertPublicOriginAllowsRequest("http://127.0.0.1:3010", {
      origin: "",
      host: "127.0.0.1:3010",
    }),
    true
  );
});

test("Origin も Host も合わないと拒否", () => {
  assert.equal(
    assertPublicOriginAllowsRequest("https://example.com", {
      origin: "",
      host: "evil.example",
    }),
    false
  );
});
