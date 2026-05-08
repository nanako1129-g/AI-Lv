import test from "node:test";
import assert from "node:assert/strict";
import { normalizeParsedResult } from "../shared/dars.js";

test("normalizeParsedResult: 不正入力でも安全な既定値に正規化する", () => {
  const result = normalizeParsedResult(null);
  assert.equal(result.level, 3);
  assert.equal(result.levelName, "レベル 3");
  assert.equal(result.evidenceBullets.length, 2);
  assert.equal(result.clarifyingQuestions.length, 0);
});

test("normalizeParsedResult: level を 1..5 に丸める", () => {
  assert.equal(normalizeParsedResult({ level: -10 }).level, 1);
  assert.equal(normalizeParsedResult({ level: 99 }).level, 5);
  assert.equal(normalizeParsedResult({ level: 2.7 }).level, 3);
});

test("normalizeParsedResult: 箇条書きと質問数の上限を守る", () => {
  const result = normalizeParsedResult({
    evidenceBullets: ["a", "b", "c", "d", "e"],
    clarifyingQuestions: ["q1", "q2", "q3"],
  });
  assert.deepEqual(result.evidenceBullets, ["a", "b", "c", "d"]);
  assert.deepEqual(result.clarifyingQuestions, ["q1", "q2"]);
});
