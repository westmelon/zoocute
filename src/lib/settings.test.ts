import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS } from "./settings";

describe("DEFAULT_APP_SETTINGS", () => {
  it("has readonly system defaults", () => {
    expect(DEFAULT_APP_SETTINGS).toEqual({
      theme: "system",
      writeMode: "readonly",
      pluginDirectory: null,
    });
  });
});
