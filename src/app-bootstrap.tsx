import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/app.css";
import App from "./App";
import { loadAppSettings } from "./lib/settings";
import type { ThemePreference } from "./lib/types";

function getSystemThemeMediaQuery() {
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)");
  }

  return {
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

export function applyThemePreference(theme: ThemePreference) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.setAttribute("data-theme", theme);
    return;
  }

  const prefersDark = getSystemThemeMediaQuery().matches;
  document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
}

export function watchSystemThemePreference(theme: ThemePreference) {
  applyThemePreference(theme);

  if (theme !== "system") {
    return () => undefined;
  }

  const mediaQuery = getSystemThemeMediaQuery();
  const handleChange = (event: MediaQueryListEvent | { matches: boolean }) => {
    document.documentElement.setAttribute("data-theme", event.matches ? "dark" : "light");
  };

  mediaQuery.addEventListener("change", handleChange);
  return () => {
    mediaQuery.removeEventListener("change", handleChange);
  };
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
