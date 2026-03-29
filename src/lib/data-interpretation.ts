import type { InterpretedNodeData, NodeDetails } from "./types";

function isJsonString(value: string) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive interpretation from a NodeDetails object.
 *
 * When the backend has already classified the data (dataKind, editable,
 * displayModeLabel are present and non-empty), those authoritative values are
 * used directly. The legacy re-derivation from formatHint/value is kept as a
 * fallback for callers that pass a partial object.
 */
export function interpretNodeData(node: Pick<NodeDetails, "path" | "value"> & Partial<Pick<NodeDetails, "formatHint" | "dataKind" | "displayModeLabel" | "editable">>): InterpretedNodeData {
  // Use authoritative backend values when available.
  if (node.dataKind && node.displayModeLabel) {
    const editable = node.editable ?? false;
    return {
      kind: node.dataKind,
      modeLabel: node.displayModeLabel,
      editable,
      helperText: editable ? null : "当前内容无法安全编辑"
    };
  }

  // Legacy fallback: derive from formatHint and value.
  if (node.formatHint === "binary") {
    return {
      kind: "binary",
      modeLabel: "二进制 · 只读",
      editable: false,
      helperText: "当前内容无法安全编辑"
    };
  }

  if (node.formatHint === "unknown") {
    return {
      kind: "binary",
      modeLabel: "二进制 · 只读",
      editable: false,
      helperText: "当前内容无法安全编辑"
    };
  }

  if (isJsonString(node.value)) {
    return {
      kind: "json",
      modeLabel: "JSON · 可编辑",
      editable: true,
      helperText: null
    };
  }

  return {
    kind: "text",
    modeLabel: "文本 · 可编辑",
    editable: true,
    helperText: null
  };
}
