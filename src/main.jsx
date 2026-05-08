import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import AppDarsOnly from "./AppDarsOnly.jsx";

/**
 * 画面切替を環境変数で自動化:
 * - VITE_APP_VARIANT=dars（既定）
 * - VITE_APP_VARIANT=home
 */
const AppRoot =
  import.meta.env.VITE_APP_VARIANT === "home" ? App : AppDarsOnly;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>
);
