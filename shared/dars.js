/** サーバー側で利用（クライアントにキーを出さない） */
export const DEFAULT_MODEL = "gemini-2.0-flash";

export const PRIMARY_AXIS_VALUES = [
  "非開発者（ビジネス職など）",
  "開発者（エンジニア）",
];

/** Gemini generationConfig 用（型名は小文字の JSON Schema） */
export const RESULT_JSON_SCHEMA = {
  type: "object",
  properties: {
    level: { type: "integer", minimum: 1, maximum: 5 },
    levelName: { type: "string" },
    reason: { type: "string" },
    evidenceBullets: {
      type: "array",
      items: { type: "string" },
      minItems: 2,
      maxItems: 4,
    },
    clarifyingQuestions: {
      type: "array",
      items: { type: "string" },
      maxItems: 2,
    },
    goodPoint: { type: "string" },
    advice: { type: "string" },
    nextAction: { type: "string" },
    alternateAxisComment: { type: "string" },
    orgGrowthBridge: { type: "string" },
    companyAlignmentTip: { type: "string" },
  },
  required: [
    "level",
    "levelName",
    "reason",
    "evidenceBullets",
    "clarifyingQuestions",
    "goodPoint",
    "advice",
    "nextAction",
    "alternateAxisComment",
    "orgGrowthBridge",
    "companyAlignmentTip",
  ],
};

export function buildSystemInstruction(primaryAxisLabel) {
  return `あなたは DeNA のプレスリリース等に公開されている「DeNA AI Readiness Score（DARS）」の概要だけをルーブリックとして用いるアシスタントです。社内独自の詳細基準や機密情報は持たず、公開情報の範囲で応答してください。

【最重要の注意（モデルとユーザー双方に明示）】
- この出力は公式の DARS 認定や社内評価ではありません。公開文脈に沿った参考用のデモです。
- レベル 2〜4 は公開されているレベル 1 と 5 の定義の間を、公開文脈に沿って補間した推定です。断定しない表現を使ってください。
- 個人の短い自己申告から組織レベルを断定しないでください。組織レベルは press 上の定義を踏まえた「参考のつなぎコメント」（orgGrowthBridge）にとどめてください。

【公開されている DARS の骨子（出典: DeNA ニュース等）】
- 個人レベル: 開発者（開発を主業務とするエンジニア）と非開発者（ビジネス／クリエイティブ／マネージャー等）に分類。レベル 1 は「基礎的な知識や利用習慣がある」状態、レベル 5 は「AIを軸とした全体設計やビジネス変革ができる」状態（公開説明に準拠）。
- 組織レベル（参考）: レベル 1 は組織の中で AI を試し始めている段階、レベル 5 は AI だからこそ可能な戦略が実行されている段階、等の公開説明がある。個人入力から組織を決め打ちしないこと。

【ユーザーの主軸】
- 今回の主軸は「${primaryAxisLabel}」です。もう一方の軸（副軸）視点の短いコメントを alternateAxisComment に必ず含めてください。

【companyAlignmentTip】
- DeNA の公開メッセージ（従業員・組織の AI 活用を可視化し AI ネイティブな組織へ、等）に沿った一言。宣伝や過大表現は避け、中立的に。

【読みやすさ・トーン（重要）】
- 文章は前向きで、次の行動につながるトーンにしてください。ただし褒めすぎ・断定しすぎは避けます。
- 絵文字は控えめに使います（全体で 0〜2 個まで）。多用しないでください。
- 絵文字を使う場合は、goodPoint / advice / nextAction のいずれかに限定し、同じ文に連続で入れないでください。
- evidenceBullets / clarifyingQuestions には絵文字を入れないでください。

【匿名化された入力への対応（重要）】
- ユーザーはセキュリティのため、固有名詞を避け抽象化して書いていることがあります。社名・プロジェクト名・製品名が無いこと自体を減点理由にしないでください。
- 文脈から、技術的な工夫（例: プロンプト設計、評価・反復、ツール連携、レビュー文化）、AI の利用範囲・深さ、ビジネスや業務への貢献の度合いを汲み取り、DARS 公開概要に沿ってレベルを推定してください。
- 入力に無い固有名詞を推測して創作しないでください。説明は一般表現・役割ベースで書いてください。不足があれば clarifyingQuestions で穏やかに確認してください。

日本語で、次のキーだけを持つ単一の JSON オブジェクトとして出力してください（前後に説明文やコードフェンスは付けない）。
level(number 1〜5), levelName, reason, evidenceBullets(string の配列 2〜4 件),
clarifyingQuestions(string の配列 最大2), goodPoint, advice, nextAction,
alternateAxisComment, orgGrowthBridge, companyAlignmentTip`;
}

/**
 * @param {unknown} raw
 */
export function normalizeParsedResult(raw) {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
  let level = Number(o.level);
  if (!Number.isFinite(level)) level = 3;
  level = Math.min(5, Math.max(1, Math.round(level)));

  const str = (v, fallback = "") =>
    typeof v === "string" && v.trim() ? v.trim() : fallback;

  let bullets = Array.isArray(o.evidenceBullets)
    ? o.evidenceBullets.map((b) => (typeof b === "string" ? b.trim() : "")).filter(Boolean)
    : [];
  while (bullets.length < 2) {
    bullets.push(
      bullets.length === 0
        ? "公開されている DARS の観点に照らし、入力から読み取れる事実が限定的でした。"
        : "追加の具体例があれば、レベル判断の精度が上がります。"
    );
  }
  if (bullets.length > 4) bullets = bullets.slice(0, 4);

  let questions = Array.isArray(o.clarifyingQuestions)
    ? o.clarifyingQuestions
        .map((q) => (typeof q === "string" ? q.trim() : ""))
        .filter(Boolean)
    : [];
  if (questions.length > 2) questions = questions.slice(0, 2);

  return {
    level,
    levelName: str(o.levelName, `レベル ${level}`),
    reason: str(o.reason, "理由の生成に失敗したため要約できませんでした。"),
    evidenceBullets: bullets,
    clarifyingQuestions: questions,
    goodPoint: str(o.goodPoint, "続ける意欲や関心が伝わります。"),
    advice: str(o.advice, "公開情報に沿った学習・実践を積み重ねるとよいでしょう。"),
    nextAction: str(o.nextAction, "次の一歩として、具体的な利用シーンを一つ書き出してみてください。"),
    alternateAxisComment: str(
      o.alternateAxisComment,
      "副軸の観点では、役割に応じたツール選定と振り返りが有効です。"
    ),
    orgGrowthBridge: str(
      o.orgGrowthBridge,
      "組織レベルは公開説明上の概念であり、個人の短文からは断定しません。"
    ),
    companyAlignmentTip: str(
      o.companyAlignmentTip,
      "公開メッセージに沿うと、継続的な可視化と学習が変革の鍵とされています。"
    ),
  };
}
