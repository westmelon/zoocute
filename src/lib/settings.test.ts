import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
} from "./settings";

describe("app settings persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns readonly system defaults when storage is empty", () => {
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("falls back to legacy theme storage when unified settings are absent", () => {
    localStorage.setItem("zoocute:theme", "dark");

    expect(loadAppSettings()).toEqual({
      ...DEFAULT_APP_SETTINGS,
      theme: "dark",
    });
  });

  it("persists the unified settings object", () => {
    saveAppSettings({
      theme: "light",
      writeMode: "readwrite",
      pluginDirectory: "C:/plugins",
    });

    expect(loadAppSettings()).toEqual({
      theme: "light",
      writeMode: "readwrite",
      pluginDirectory: "C:/plugins",
    });
  });
});
