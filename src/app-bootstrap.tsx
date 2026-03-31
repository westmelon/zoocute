import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/app.css";
import App from "./App";

export function injectTheme() {
  const stored = localStorage.getItem("zoocute:theme");
  if (stored === "dark" || stored === "light") {
    document.documentElement.setAttribute("data-theme", stored);
  } else {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
  }
}

export function bootstrapApp() {
  injectTheme();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
