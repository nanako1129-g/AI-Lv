import { useCallback, useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/** DeNA プレスリリース（DARS 公開概要） */
export const DARS_PUBLIC_SOURCE_URL =
  "https://dena.com/jp/news/5279/";

/** @param {string} [prefix] */
export function buildPdfFileName(prefix = "dars-check") {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.pdf`;
}

/** Gemini 呼び出しはサーバー経由（API キーをブラウザに出さない） */
async function evaluateViaServer(userText, primaryAxis) {
  const connectionHint =
    "API に接続できませんでした。ターミナルで npm run dev を実行し、http://localhost:5173 を開いていますか？（vite だけ起動していると /api が使えません。本番ビルド後は npm start で http://localhost:3000 です。）";

  let res;
  try {
    res = await fetch("/api/dars-evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userText, primaryAxis }),
      credentials: "same-origin",
    });
  } catch {
    throw new Error(connectionHint);
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* プロキシ先ダウン等で HTML が返る場合 */
  }

  if (!res.ok) {
    if (typeof data.error === "string" && data.error) {
      throw new Error(data.error);
    }
    if (res.status === 404 || res.status === 502 || res.status === 504) {
      throw new Error(connectionHint);
    }
    throw new Error(
      `サーバーからエラー応答がありました（${res.status}）。しばらくしてから再度お試しください。`
    );
  }
  if (!data.ok || !data.result) {
    throw new Error("想定外の応答です。API サーバーが起動しているか確認してください。");
  }
  return data.result;
}

function IconCheckShield({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l7 3v6c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z"
        fill="#eef2ff"
        stroke="#6366f1"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M9 12l2 2 4-5" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevron({ className, open }) {
  return (
    <svg
      className={`${className} transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconMic({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
    </svg>
  );
}

export default function AppDarsOnly() {
  const [primaryAxis, setPrimaryAxis] = useState("非開発者（ビジネス職など）");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(true);

  const pdfRef = useRef(null);

  const speechSupported =
    typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    if (!voiceOn || !speechSupported) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "ja-JP";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (ev) => {
      let chunk = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        chunk += ev.results[i][0].transcript;
      }
      if (chunk) {
        setInput((prev) => (prev ? `${prev}${chunk}` : chunk));
      }
    };
    rec.onerror = () => {};
    rec.start();
    return () => {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    };
  }, [voiceOn, speechSupported]);

  const runEvaluate = useCallback(async () => {
    setError("");
    setResult(null);
    const trimmed = input.trim();
    if (trimmed.length < 8) {
      setError("自己申告は短すぎます。もう少し具体的に書いてください。");
      return;
    }
    if (trimmed.length > 12000) {
      setError("入力が長すぎます（最大 12,000 文字）。要点に絞ってください。");
      return;
    }

    setLoading(true);
    try {
      const data = await evaluateViaServer(trimmed, primaryAxis);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "判定に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [input, primaryAxis]);

  const savePdf = useCallback(async () => {
    const el = pdfRef.current;
    if (!el) return;
    setPdfBusy(true);
    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(buildPdfFileName());
    } catch {
      setError("PDF の生成に失敗しました。もう一度お試しください。");
    } finally {
      setPdfBusy(false);
    }
  }, []);

  const selectShell =
    "w-full appearance-none rounded-xl border border-slate-200/90 bg-white bg-[length:0.875rem] bg-[right_0.75rem_center] bg-no-repeat py-3 pl-3 pr-10 text-sm font-medium text-slate-800 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15";

  return (
    <div className="min-h-screen px-4 py-10 pb-32 font-cute">
      <div className="mx-auto max-w-lg space-y-8">
        <article className="rounded-2xl border border-slate-200/80 bg-white/85 p-6 shadow-card backdrop-blur-md sm:rounded-3xl sm:p-8">
          <header className="text-center">
            <p className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-slate-400">
              DARS · unofficial demo
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
              <span
                className="shrink-0 select-none font-sans text-[2rem] leading-none opacity-90 sm:text-[2.25rem]"
                aria-hidden
              >
                🤖
              </span>
              <h1 className="max-w-[16rem] text-center text-[1.55rem] font-bold leading-snug tracking-tight text-slate-900 sm:max-w-none sm:text-[1.85rem]">
                AI活用レベル診断
                <span className="whitespace-nowrap font-sans font-normal text-slate-500">
                  {" "}
                  <span aria-hidden>🌸</span>
                </span>
              </h1>
              <span
                className="shrink-0 select-none font-sans text-[2rem] leading-none opacity-90 sm:text-[2.25rem]"
                aria-hidden
              >
                📈
              </span>
            </div>
            <p className="mt-5 text-sm font-medium tracking-wide text-slate-600 sm:text-base">
              DeNA「DARS」指標に合わせた自己判定
            </p>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-slate-500 sm:text-sm">
              セキュリティを守りながら、取り組みの輪郭を言語化する
            </p>
          </header>

          {/* 出典・非公式: 常時表示 */}
          <section className="mt-8 rounded-xl border border-slate-200/90 border-l-[3px] border-l-indigo-500 bg-slate-50/70 p-4 sm:p-5">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-indigo-600/90">
              非公式デモ
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-700 sm:text-sm">
              DeNA プレス等の公開概要のみを参考にしたデモです。公式 DARS 認定ではありません。Lv2〜4
              は公開文脈に沿った補間による参考値です。
            </p>
            <p className="mt-3 text-[0.7rem] leading-relaxed text-slate-600 sm:text-xs">
              入力内容はこのアプリのサーバーに送られ、判定のために Google Gemini（生成 AI）へ渡されます。
              機密・個人を特定できる情報は書かないでください。
            </p>
            <a
              href={DARS_PUBLIC_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex text-xs font-medium text-indigo-600 underline decoration-slate-300 underline-offset-4 transition hover:text-indigo-800 sm:text-sm"
            >
              出典: DeNA ニュース「DARS を導入開始」
            </a>
          </section>

          {/* 安心のための書き方ガイド（折りたたみ + NG/OK） */}
          <div className="mt-7 overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setGuideOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 px-4 py-3.5 text-left transition hover:bg-slate-50/90"
              aria-expanded={guideOpen}
            >
              <span className="flex items-center gap-3">
                <IconCheckShield className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" />
                <span className="text-sm font-semibold text-slate-800 sm:text-[0.95rem]">
                  安心のための書き方ガイド
                </span>
              </span>
              <IconChevron className="h-5 w-5 shrink-0 text-slate-400" open={guideOpen} />
            </button>
            {guideOpen ? (
              <div className="space-y-4 border-t border-slate-100 px-4 pb-5 pt-4">
                <p className="text-xs leading-relaxed text-slate-600 sm:text-sm">
                  固有名詞は伏せて大丈夫。{" "}
                  <strong className="font-semibold text-slate-800">工夫の中身</strong>
                  が伝われば参考レベルはつきます。下の NG / OK を参考に、自分なりにぼかしてみてください。
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-3">
                    <p className="mb-2.5 text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">
                      NG · 具体すぎ
                    </p>
                    <ul className="space-y-2 text-[0.72rem] leading-snug text-slate-700 sm:text-xs">
                      <li className="rounded-md border border-slate-100 bg-white/90 px-2.5 py-2">
                        「X社向けプロジェクト Delta の契約書…」
                      </li>
                      <li className="rounded-md border border-slate-100 bg-white/90 px-2.5 py-2">
                        「〇〇部 △△さんと Sl〇〇 で…」
                      </li>
                      <li className="rounded-md border border-slate-100 bg-white/90 px-2.5 py-2">
                        「売上 1.2 億の案件で…」
                      </li>
                    </ul>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-3">
                    <p className="mb-2.5 text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">
                      OK · 抽象化
                    </p>
                    <ul className="space-y-2 text-[0.72rem] leading-snug text-slate-700 sm:text-xs">
                      <li className="rounded-md border border-slate-100 bg-white/90 px-2.5 py-2">
                        「中規模サービスの基幹に関わる要件整理で…」
                      </li>
                      <li className="rounded-md border border-slate-100 bg-white/90 px-2.5 py-2">
                        「関係部署のメンバーとドキュメントツールで…」
                      </li>
                      <li className="rounded-md border border-slate-100 bg-white/90 px-2.5 py-2">
                        「前年より工数が減るくらいの効果が出た…」
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-600 sm:text-sm">
                あなたの主軸
              </label>
              <select
                value={primaryAxis}
                onChange={(e) => setPrimaryAxis(e.target.value)}
                className={selectShell}
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                }}
              >
                <option value="非開発者（ビジネス職など）">Biz（ビジネス／企画）</option>
                <option value="開発者（エンジニア）">エンジニア（開発）</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-600 sm:text-sm">
                判定フレーム
              </label>
              <select
                disabled
                className={`${selectShell} cursor-not-allowed border-slate-100 bg-slate-50 text-slate-500`}
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                }}
              >
                <option>DARSデモ（DeNA 公開情報ベース）</option>
              </select>
            </div>
          </div>

          <label className="mt-7 block text-sm font-semibold text-slate-800" htmlFor="dars-input">
            取り組んだ業務・AI活用の工夫
            <span className="mt-0.5 block text-xs font-normal text-slate-500">
              固有名詞なし・抽象表現で問題ありません
            </span>
          </label>
          <textarea
            id="dars-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={8}
            placeholder="(例) 特定のルーチン業務において、生成AIを使って初稿を作り、自分用のプロンプトを少しずつ育てている。レビューはチームの決まりに沿って…"
            className="mt-2 w-full resize-y rounded-xl border border-slate-200/90 bg-white p-4 text-sm leading-relaxed text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
          />

          {speechSupported ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setVoiceOn((v) => !v)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition sm:text-sm ${
                  voiceOn
                    ? "border-indigo-600 bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <IconMic className="h-5 w-5" />
                音声入力 {voiceOn ? "ON" : "OFF"}
              </button>
              <span className="text-[0.65rem] text-slate-500 sm:text-xs">Web Speech API</span>
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-400">このブラウザでは音声入力を使えません。</p>
          )}

          <button
            type="button"
            disabled={loading}
            onClick={runEvaluate}
            className="mt-8 w-full rounded-xl border border-rose-200/80 bg-gradient-to-r from-rose-100 via-pink-100 to-rose-100 py-3.5 text-sm font-semibold tracking-wide text-rose-900 shadow-sm transition hover:from-rose-200/90 hover:via-pink-200/80 hover:to-rose-200/90 disabled:cursor-not-allowed disabled:opacity-50 sm:py-4 sm:text-[0.95rem]"
          >
            {loading ? "分析中…" : "分析を開始"}
          </button>
          {error ? (
            <p className="mt-4 rounded-xl border border-red-200/90 bg-red-50/80 p-3 text-sm text-red-900/90">
              {error}
            </p>
          ) : null}
        </article>

      {result ? (
        <>
          <article className="space-y-5 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-card backdrop-blur-md sm:rounded-3xl sm:p-8">
            <div className="flex items-end justify-between gap-3 border-b border-slate-100 pb-4">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">結果（参考）</h2>
              <span className="text-[0.65rem] font-medium uppercase tracking-wider text-slate-400">
                unofficial
              </span>
            </div>
            <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-indigo-50/30 p-5">
              <p className="font-sans text-4xl font-bold tabular-nums tracking-tight text-indigo-600">
                Lv.{result.level}
              </p>
              <p className="mt-1 text-base font-semibold text-slate-900">{result.levelName}</p>
              <p className="mt-3 text-sm leading-relaxed text-slate-700">{result.reason}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-white p-4">
              <h3 className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">
                根拠
              </h3>
              <ul className="mt-2 list-inside list-disc space-y-1.5 text-sm leading-relaxed text-slate-700">
                {result.evidenceBullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
            {result.clarifyingQuestions.length > 0 ? (
              <div className="rounded-xl border border-slate-100 bg-white p-4">
                <h3 className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">
                  確認したいこと（任意）
                </h3>
                <ul className="mt-2 list-inside list-decimal space-y-1.5 text-sm leading-relaxed text-slate-700">
                  {result.clarifyingQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 text-sm">
                <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">
                  いいところ
                </span>
                <p className="mt-2 leading-relaxed text-slate-800">{result.goodPoint}</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 text-sm">
                <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">
                  アドバイス
                </span>
                <p className="mt-2 leading-relaxed text-slate-800">{result.advice}</p>
              </div>
            </div>
            <div className="rounded-xl border border-slate-100 bg-white p-4 text-sm">
              <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">
                次の一歩
              </span>
              <p className="mt-2 leading-relaxed text-slate-800">{result.nextAction}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-white p-4 text-sm">
              <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">
                もう一方の軸から
              </span>
              <p className="mt-2 leading-relaxed text-slate-800">{result.alternateAxisComment}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/40 p-4 text-sm text-slate-700">
              <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">
                組織レベル（参考のみ）
              </span>
              <p className="mt-2 leading-relaxed">{result.orgGrowthBridge}</p>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 text-sm">
              <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-indigo-600/80">
                公開メッセージに沿った一言
              </span>
              <p className="mt-2 leading-relaxed text-slate-800">{result.companyAlignmentTip}</p>
            </div>

            <button
              type="button"
              disabled={pdfBusy}
              onClick={savePdf}
              className="w-full rounded-xl border border-slate-200 bg-white py-3.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pdfBusy ? "PDF 生成中…" : "結果を PDF（A4）で保存"}
            </button>
          </article>

          {/* オフスクリーン PDF 用 */}
          <div
            ref={pdfRef}
            className="fixed left-[-9999px] top-0 w-[794px] bg-white p-10 font-cute text-slate-900"
            aria-hidden
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              非公式デモ・参考出力
            </p>
            <h2 className="text-2xl font-bold text-slate-900">AI活用レベル診断・結果</h2>
            <p className="mt-1 text-xs text-slate-600">
              出典: {DARS_PUBLIC_SOURCE_URL}
            </p>
            <p className="mt-4 text-sm">
              <strong>主軸:</strong> {primaryAxis}
            </p>
            <p className="mt-4 text-4xl font-bold text-indigo-600">Lv.{result.level}</p>
            <p className="text-xl font-semibold text-slate-900">{result.levelName}</p>
            <p className="mt-3 text-sm leading-relaxed">{result.reason}</p>
            <p className="mt-4 text-sm font-bold">根拠</p>
            <ul className="list-inside list-disc text-sm">
              {result.evidenceBullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            {result.clarifyingQuestions.length > 0 ? (
              <>
                <p className="mt-4 text-sm font-bold">確認したいこと</p>
                <ol className="list-inside list-decimal text-sm">
                  {result.clarifyingQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ol>
              </>
            ) : null}
            <p className="mt-4 text-sm">
              <strong>いいところ:</strong> {result.goodPoint}
            </p>
            <p className="mt-2 text-sm">
              <strong>アドバイス:</strong> {result.advice}
            </p>
            <p className="mt-2 text-sm">
              <strong>次の一歩:</strong> {result.nextAction}
            </p>
            <p className="mt-2 text-sm">
              <strong>もう一方の軸:</strong> {result.alternateAxisComment}
            </p>
            <p className="mt-2 text-sm">
              <strong>組織（参考）:</strong> {result.orgGrowthBridge}
            </p>
            <p className="mt-2 text-sm">
              <strong>公開メッセージに沿った一言:</strong> {result.companyAlignmentTip}
            </p>
            <p className="mt-8 text-xs text-stone-500">
              入力要約（抜粋）: {input.trim().slice(0, 800)}
              {input.trim().length > 800 ? "…" : ""}
            </p>
          </div>
        </>
      ) : null}
      </div>
    </div>
  );
}
