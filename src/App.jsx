/**
 * 元画面（プレースホルダー）。
 * VITE_APP_VARIANT=home でこの画面を表示します。
 */
export default function App() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center font-cute">
      <p className="max-w-md text-lg text-slate-700">
        こちらは既定のホーム画面です。DARS デモ版を表示するには{" "}
        <code className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-sm text-slate-900">
          main.jsx
        </code>{" "}
        で{" "}
        <code className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-sm text-slate-900">
          AppDarsOnly.jsx
        </code>{" "}
        を import してください。
      </p>
    </div>
  );
}
