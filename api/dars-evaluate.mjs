import { evaluateDarsWithRetry } from "../server/evaluate.mjs";
import { PRIMARY_AXIS_VALUES } from "../shared/dars.js";
import { assertPublicOriginAllowsRequest } from "../shared/originGuard.mjs";

const PRIMARY = new Set(PRIMARY_AXIS_VALUES);
const MAX_TEXT = 12_000;
const MIN_TEXT = 8;

function getRequestHost(req) {
  const h = req.headers?.host;
  if (h) return String(h);
  const xf = req.headers?.["x-forwarded-host"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const originOk = assertPublicOriginAllowsRequest(process.env.PUBLIC_ORIGIN, {
      origin: req.headers?.origin,
      host: getRequestHost(req),
    });
    if (!originOk) {
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
    const msg =
      code === 429
        ? "AI サービス側の利用制限に達しました。しばらく時間をおいてから再度お試しください。"
        : "判定処理に失敗しました。時間をおいて再度お試しください。";
    return res.status(code).json({ ok: false, error: msg });
  }
}
