import {
  DEFAULT_MODEL,
  RESULT_JSON_SCHEMA,
  buildSystemInstruction,
  normalizeParsedResult,
} from "../shared/dars.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {string | undefined} model */
export function resolveGeminiModel(model) {
  const m = String(model || DEFAULT_MODEL).trim();
  if (!/^gemini-[0-9a-zA-Z.-]+$/.test(m)) return DEFAULT_MODEL;
  return m;
}

/**
 * @param {object} p
 * @param {string} p.apiKey
 * @param {string} p.model
 * @param {string} p.userText
 * @param {string} p.primaryAxis
 */
async function callGeminiOnce({ apiKey, model, userText, primaryAxis }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: {
      parts: [{ text: buildSystemInstruction(primaryAxis) }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `次の自己申告テキストを、公開情報に基づく DARS 個人レベルの参考目安として評価してください（非公式・推定）。

【主軸】${primaryAxis}

ユーザーは情報をぼかして書いている可能性があります。固有名詞がなくても、文脈から技術的な工夫・習熟度・業務・ビジネスへの貢献度を読み取って判定してください。入力にない名称は推測で補わないでください。

---
${userText}
---`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.35,
      responseMimeType: "application/json",
      responseJsonSchema: RESULT_JSON_SCHEMA,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini API エラー (${res.status})`;
    const err = new Error(msg);
    const s = res.status;
    err.status = s === 429 ? 429 : s >= 500 ? 503 : 400;
    throw err;
  }

  const text =
    data?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? "";
  if (!text) {
    const block = data?.candidates?.[0]?.finishReason;
    const err = new Error(
      block ? `応答が生成されませんでした (${block})` : "空の応答です"
    );
    err.status = 502;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const err = new Error("JSON のパースに失敗しました");
    err.status = 502;
    throw err;
  }
  return normalizeParsedResult(parsed);
}

/**
 * @param {object} p
 * @param {string} p.apiKey
 * @param {string} p.userText
 * @param {string} p.primaryAxis
 * @param {string} [p.model]
 * @param {number} [p.maxAttempts]
 */
export async function evaluateDarsWithRetry(p) {
  const maxAttempts = p.maxAttempts ?? 5;
  const model = resolveGeminiModel(p.model);
  let delayMs = 1000;
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await callGeminiOnce({
        apiKey: p.apiKey,
        model,
        userText: p.userText,
        primaryAxis: p.primaryAxis,
      });
    } catch (e) {
      lastErr = e;
      const status = /** @type {{ status?: number }} */ (e).status;
      const noRetry =
        status === 400 ||
        status === 401 ||
        status === 403 ||
        status === 404 ||
        status === 429;
      if (noRetry || i === maxAttempts - 1) break;
      await sleep(delayMs);
      delayMs *= 2;
    }
  }
  throw lastErr;
}
