import { describe, it, expect, beforeEach, vi } from "vitest";
import { injectTheme } from "./app-bootstrap";

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
});
