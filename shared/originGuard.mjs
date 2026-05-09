/**
 * PUBLIC_ORIGIN が設定されているときだけ検証する。
 * - Origin が一致する、または
 * - 同一オリジン由来で Origin が付かない場合に Host が一致する（ブラウザ・Vercel 互換）
 *
 * @param {string | undefined} publicOrigin 例: https://ai-lv.vercel.app（末尾スラッシュなし推奨）
 * @param {{ origin?: string; host?: string }} headers
 */
export function assertPublicOriginAllowsRequest(publicOrigin, headers) {
  const expected = String(publicOrigin || "")
    .trim()
    .replace(/\/+$/, "");
  if (!expected) return true;

  const origin = String(headers.origin || "")
    .trim()
    .replace(/\/+$/, "");
  if (origin === expected) return true;

  let expectedHost;
  try {
    expectedHost = new URL(expected).host;
  } catch {
    return false;
  }

  const host = String(headers.host || "").trim();
  if (!origin && host && host === expectedHost) return true;

  return false;
}
