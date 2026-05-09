import { DEFAULT_MODEL, buildSystemInstruction, normalizeParsedResult } from "../shared/dars.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {string} raw */
function extractJsonObjectText(raw) {
  const t = String(raw || "").trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  if (fence) return fence[1].trim();
  return t;
}

/** @param {unknown} data generateContent のレスポンス */
function candidatesTextConcat(data) {
  const cand = data?.candidates?.[0];
  const parts = cand?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
}

/**
 * @param {string} text
 */
function parseModelJson(text) {
  const trimmed = extractJsonObjectText(text);
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    const err = new Error("JSON のパースに失敗しました");
    err.status = 502;
    throw err;
  }
}

/** @param {string | undefined} model */
export function resolveGeminiModel(model) {
  const m = String(model || DEFAULT_MODEL).trim();
  if (!/^gemini-[0-9a-zA-Z.-]+$/.test(m)) return DEFAULT_MODEL;
  return m;
}

function mapGeminiHttpStatus(resStatus) {
  const s = resStatus;
  if (s === 429) return 429;
  if (s >= 500) return 503;
  if (s === 401 || s === 403) return s;
  if (s === 404) return 404;
  return 400;
}

/**
 * @param {string} apiKey
 * @returns {Promise<string[]>} models/xxxx 形式の name 一覧
 */
async function listGeminiModels(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `models API エラー (${res.status})`);
    err.status = mapGeminiHttpStatus(res.status);
    throw err;
  }

  const rows = Array.isArray(data?.models) ? data.models : [];
  const names = [];
  for (const r of rows) {
    const name = typeof r?.name === "string" ? r.name : "";
    if (!name.startsWith("models/")) continue;
    const methods = Array.isArray(r?.supportedGenerationMethods)
      ? r.supportedGenerationMethods
      : [];
    if (methods.length && !methods.includes("generateContent")) continue;
    names.push(name);
  }
  return names;
}

/**
 * listModels() の結果から優先順を組む
 * @param {string[]} names
 */
function buildModelOrderFromNames(names) {
  const slugs = names
    .map((n) => n.replace(/^models\//, ""))
    .filter((s) => /^gemini-[0-9a-zA-Z.-]+$/.test(s));

  const priority = [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ];
  const picked = [];
  for (const p of priority) {
    if (slugs.includes(p)) picked.push(p);
  }
  for (const s of slugs) {
    if (!picked.includes(s) && s.includes("flash")) picked.push(s);
  }
  return picked;
}

function buildUserPrompt(userText, primaryAxis) {
  return `次の自己申告テキストを、公開情報に基づく DARS 個人レベルの参考目安として評価してください（非公式・推定）。

【主軸】${primaryAxis}

ユーザーは情報をぼかして書いている可能性があります。固有名詞がなくても、文脈から技術的な工夫・習熟度・業務・ビジネスへの貢献度を読み取って判定してください。入力にない名称は推測で補わないでください。

---
${userText}
---`;
}

/**
 * @param {object} p
 * @param {string} p.apiKey
 * @param {string} p.model
 * @param {string} p.userText
 * @param {string} p.primaryAxis
 * @param {boolean} p.mergedInstruction
 */
async function callGeminiOnceRaw({ apiKey, model, userText, primaryAxis, mergedInstruction }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const userBlock = buildUserPrompt(userText, primaryAxis);

  const body = mergedInstruction
    ? {
        contents: [
          {
            role: "user",
            parts: [{ text: `${buildSystemInstruction(primaryAxis)}\n\n${userBlock}` }],
          },
        ],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
        },
      }
    : {
        systemInstruction: {
          parts: [{ text: buildSystemInstruction(primaryAxis) }],
        },
        contents: [{ role: "user", parts: [{ text: userBlock }] }],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
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
    err.status = mapGeminiHttpStatus(res.status);
    throw err;
  }

  const text = candidatesTextConcat(data).trim();
  if (!text) {
    const block = data?.candidates?.[0]?.finishReason;
    const err = new Error(
      block ? `応答が生成されませんでした (${block})` : "空の応答です"
    );
    err.status = 502;
    throw err;
  }

  const parsed = parseModelJson(text);
  return normalizeParsedResult(parsed);
}

/**
 * @param {object} p
 * @param {string} p.apiKey
 * @param {string} p.model
 * @param {string} p.userText
 * @param {string} p.primaryAxis
 */
async function callGeminiOnce(p) {
  try {
    return await callGeminiOnceRaw({ ...p, mergedInstruction: false });
  } catch (e) {
    const status = /** @type {{ status?: number }} */ (e).status;
    if (status !== 400) throw e;
    return await callGeminiOnceRaw({ ...p, mergedInstruction: true });
  }
}

/**
 * @param {object} p
 * @param {string} p.apiKey
 * @param {string} p.model
 * @param {string} p.userText
 * @param {string} p.primaryAxis
 * @param {number} [p.maxAttempts]
 */
async function attemptsWithBackoffForModel(p) {
  const maxAttempts = p.maxAttempts ?? 5;
  let delayMs = 1000;
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await callGeminiOnce({
        apiKey: p.apiKey,
        model: p.model,
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

/**
 * @param {object} p
 * @param {string} p.apiKey
 * @param {string} p.userText
 * @param {string} p.primaryAxis
 * @param {string} [p.model]
 * @param {number} [p.maxAttempts]
 */
export async function evaluateDarsWithRetry(p) {
  const preferred = resolveGeminiModel(p.model);
  const modelChain = [...new Set([preferred, DEFAULT_MODEL, "gemini-1.5-flash"])];

  let lastErr;
  for (let m = 0; m < modelChain.length; m++) {
    const model = modelChain[m];
    try {
      return await attemptsWithBackoffForModel({ ...p, model });
    } catch (e) {
      lastErr = e;
      const status = /** @type {{ status?: number }} */ (e).status;
      if (status === 401 || status === 403 || status === 429) throw e;
      if (status === 404 && m < modelChain.length - 1) continue;
      if (status === 404) {
        try {
          const dynamic = buildModelOrderFromNames(await listGeminiModels(p.apiKey)).filter(
            (x) => !modelChain.includes(x)
          );
          for (const model2 of dynamic) {
            try {
              return await attemptsWithBackoffForModel({ ...p, model: model2, maxAttempts: 2 });
            } catch (e2) {
              const s2 = /** @type {{ status?: number }} */ (e2).status;
              if (s2 === 401 || s2 === 403 || s2 === 429) throw e2;
              if (s2 !== 404) throw e2;
              lastErr = e2;
            }
          }
        } catch (lookupErr) {
          const ls = /** @type {{ status?: number }} */ (lookupErr).status;
          if (ls === 401 || ls === 403 || ls === 429) throw lookupErr;
        }
      }
      throw lastErr || e;
    }
  }
  throw lastErr;
}
