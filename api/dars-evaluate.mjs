import { evaluateDarsWithRetry } from "../server/evaluate.mjs";
import { PRIMARY_AXIS_VALUES } from "../shared/dars.js";

const PRIMARY = new Set(PRIMARY_AXIS_VALUES);
const MAX_TEXT = 12_000;
const MIN_TEXT = 8;

function assertSameOrigin(req) {
  const expected = process.env.PUBLIC_ORIGIN?.trim();
  if (!expected) return true;
  const origin = req.headers.origin || "";
  return origin === expected;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    if (!assertSameOrigin(req)) {
      return res.status(403).json({ ok: false, error: "許可されていないオリジンです。" });
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return res.status(503).json({
        ok: false,
        error:
          "サーバーに GEMINI_API_KEY が設定されていません。管理者向けドキュメントを参照してください。",
      });
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const { userText: rawText, primaryAxis } = body;

    if (typeof primaryAxis !== "string" || !PRIMARY.has(primaryAxis)) {
      return res.status(400).json({ ok: false, error: "主軸の値が不正です。" });
    }
    if (typeof rawText !== "string") {
      return res.status(400).json({ ok: false, error: "入力テキストが必要です。" });
    }

    const userText = rawText.trim();
    if (userText.length < MIN_TEXT) {
      return res.status(400).json({ ok: false, error: "自己申告は短すぎます。" });
    }
    if (userText.length > MAX_TEXT) {
      return res.status(400).json({ ok: false, error: "入力が長すぎます。" });
    }

    const result = await evaluateDarsWithRetry({
      apiKey,
      userText,
      primaryAxis,
      model: process.env.GEMINI_MODEL?.trim() || undefined,
    });

    return res.status(200).json({ ok: true, result });
  } catch (e) {
    const status = /** @type {{ status?: number }} */ (e).status;
    const code =
      typeof status === "number" && status >= 400 && status < 600 ? status : 502;
    if (process.env.LOG_EVAL_ERRORS === "1") {
      console.error("[dars-evaluate]", code, e instanceof Error ? e.message : e);
    }
    return res.status(code).json({
      ok: false,
      error: "判定処理に失敗しました。時間をおいて再度お試しください。",
    });
  }
}
