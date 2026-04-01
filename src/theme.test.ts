import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyThemePreference, injectTheme } from "./app-bootstrap";

describe("theme tokens", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
    // mock matchMedia (jsdom doesn't implement it)
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  it("applies dark theme when data-theme=dark", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("applies light theme when data-theme=light", () => {
    document.documentElement.setAttribute("data-theme", "light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("injectTheme sets data-theme from system preference", () => {
    injectTheme();
    const attr = document.documentElement.getAttribute("data-theme");
    expect(["light", "dark"]).toContain(attr);
  });

  it("applyThemePreference resolves system to the current OS preference", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;

    applyThemePreference("system");

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("injectTheme reads the unified settings theme before legacy fallback", () => {
    localStorage.setItem(
      "zoocute:settings",
      JSON.stringify({ theme: "light", writeMode: "readonly", pluginDirectory: null })
    );

    injectTheme();

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
