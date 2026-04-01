import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/app.css";
import App from "./App";
import { loadAppSettings } from "./lib/settings";
import type { ThemePreference } from "./lib/types";

export function applyThemePreference(theme: ThemePreference) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.setAttribute("data-theme", theme);
    return;
  }

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
}

export function injectTheme() {
  applyThemePreference(loadAppSettings().theme);
}

export function bootstrapApp() {
  injectTheme();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
