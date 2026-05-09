import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import { evaluateDarsWithRetry } from "./evaluate.mjs";
import { PRIMARY_AXIS_VALUES } from "../shared/dars.js";
import { assertPublicOriginAllowsRequest } from "../shared/originGuard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const PRIMARY = new Set(PRIMARY_AXIS_VALUES);
const MAX_TEXT = 12_000;
const MIN_TEXT = 8;

/** @type {Map<string, { count: number; resetAt: number }>} */
const rateBucket = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 40;

function pruneRate(now) {
  for (const [ip, row] of rateBucket) {
    if (now > row.resetAt + RATE_WINDOW_MS) rateBucket.delete(ip);
  }
}

function rateLimit(req, res, next) {
  const now = Date.now();
  if (Math.random() < 0.05) pruneRate(now);
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  let row = rateBucket.get(ip);
  if (!row || now > row.resetAt) {
    row = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBucket.set(ip, row);
  }
  row.count += 1;
  if (row.count > RATE_MAX) {
    return res.status(429).json({
      ok: false,
      error: "アクセスが集中しています。しばらく時間をおいてから再度お試しください。",
    });
  }
  next();
}

function assertSameOrigin(req) {
  return assertPublicOriginAllowsRequest(req.app.locals.publicOrigin, {
    origin: req.get("origin"),
    host: req.get("host"),
  });
}

export function createRuntimeConfig(env = process.env) {
  const distDir = path.join(__dirname, "../dist");
  const hasDist = fs.existsSync(path.join(distDir, "index.html"));
  const serveSpa = hasDist && (env.NODE_ENV === "production" || env.SERVE_SPA === "1");
  return {
    distDir,
    serveSpa,
    host: env.BIND_ALL === "1" ? "0.0.0.0" : "127.0.0.1",
    port: serveSpa ? Number(env.PORT || 3000) : Number(env.API_PORT || 8787),
    trustProxy: env.TRUST_PROXY === "1",
    publicOrigin: env.PUBLIC_ORIGIN?.trim() || "",
    logEvalErrors: env.LOG_EVAL_ERRORS === "1",
    apiKey: env.GEMINI_API_KEY?.trim() || "",
    model: env.GEMINI_MODEL?.trim() || "",
  };
}

export function createApp(runtime = createRuntimeConfig()) {
  const app = express();
  app.locals.publicOrigin = runtime.publicOrigin;
  app.locals.logEvalErrors = runtime.logEvalErrors;
  app.locals.apiKey = runtime.apiKey;
  app.locals.model = runtime.model;

  app.disable("x-powered-by");
  if (runtime.trustProxy) {
    app.set("trust proxy", 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(express.json({ limit: "320kb" }));

  app.post("/api/dars-evaluate", rateLimit, async (req, res) => {
    try {
      if (!assertSameOrigin(req)) {
        return res.status(403).json({ ok: false, error: "許可されていないオリジンです。" });
      }

      const apiKey = String(req.app.locals.apiKey || "").trim();
      if (!apiKey) {
        return res.status(503).json({
          ok: false,
          error:
            "サーバーに GEMINI_API_KEY が設定されていません。管理者向けドキュメントを参照してください。",
        });
      }

      const { userText: rawText, primaryAxis } = req.body ?? {};
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
        model: String(req.app.locals.model || "").trim() || undefined,
      });
      res.json({ ok: true, result });
    } catch (e) {
      const status = /** @type {{ status?: number }} */ (e).status;
      const code =
        typeof status === "number" && status >= 400 && status < 600 ? status : 502;
      if (req.app.locals.logEvalErrors) {
        console.error("[dars-evaluate]", code, e instanceof Error ? e.message : e);
      }
      res.status(code).json({
        ok: false,
        error: "判定処理に失敗しました。時間をおいて再度お試しください。",
      });
    }
  });

  if (runtime.serveSpa) {
    app.use(
      express.static(runtime.distDir, {
        maxAge: "1h",
        setHeaders(res, filePath) {
          if (filePath.endsWith("index.html")) {
            res.setHeader("Cache-Control", "no-store");
          }
        },
      })
    );
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.sendFile(path.join(runtime.distDir, "index.html"), (err) => {
        if (err) next(err);
      });
    });
  }
  return app;
}

export function startServer(runtime = createRuntimeConfig()) {
  const app = createApp(runtime);
  const server = app.listen(runtime.port, runtime.host, () => {
    if (runtime.serveSpa) {
      console.log(`[dars] 本番モード http://${runtime.host}:${runtime.port} （静的 + /api）`);
    } else {
      console.log(
        `[dars] API のみ http://${runtime.host}:${runtime.port} （Vite から /api をプロキシ）`
      );
    }
  });
  return { app, server };
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) {
  startServer();
}
