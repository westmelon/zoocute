import { describe, expect, it } from "vitest";
import { interpretNodeData } from "./lib/data-interpretation";

describe("interpretNodeData", () => {
  it("marks valid JSON as editable", () => {
    const result = interpretNodeData({
      path: "/configs/payment/switches",
      value: `{"gray_release":true}`
    });

    expect(result.kind).toBe("json");
    expect(result.modeLabel).toBe("JSON · 可编辑");
    expect(result.editable).toBe(true);
  });

  it("marks plain text as editable", () => {
    const result = interpretNodeData({
      path: "/services/gateway",
      value: "gateway_enabled=true"
    });

    expect(result.kind).toBe("text");
    expect(result.modeLabel).toBe("文本 · 可编辑");
    expect(result.editable).toBe(true);
  });

  it("marks binary hints as read only", () => {
    const result = interpretNodeData({
      path: "/services/session_blob",
      value: "ACED000573720012",
      formatHint: "binary"
    });

    expect(result.kind).toBe("binary");
    expect(result.modeLabel).toBe("二进制 · 只读");
    expect(result.editable).toBe(false);
  });

  it("maps unknown hints to binary (read only)", () => {
    const result = interpretNodeData({
      path: "/services/custom_payload",
      value: "mystery",
      formatHint: "unknown"
    });

    expect(result.kind).toBe("binary");
    expect(result.modeLabel).toBe("二进制 · 只读");
    expect(result.editable).toBe(false);
  });
});
