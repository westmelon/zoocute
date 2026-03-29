import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import type { ViewMode } from "../lib/types";

const OS_OPTIONS = {
  scrollbars: { theme: "os-theme-dark", autoHide: "scroll" as const, autoHideDelay: 800 },
} as const;

interface NodeContentPanelProps {
  value: string;
  viewMode: ViewMode;
  isEditing: boolean;
  onChange: (value: string) => void;
  onFallbackToRaw: () => void;
}

function ParseErrorPanel({
  mode,
  onFallbackToRaw,
}: {
  mode: "JSON" | "XML";
  onFallbackToRaw: () => void;
}) {
  return (
    <div className="editor-body">
      <div className="content-parse-error">
        <p>转换失败：当前内容不是合法 {mode}</p>
        <p className="content-parse-error__meta">视图模式：{mode}</p>
        <button type="button" className="btn" onClick={onFallbackToRaw}>
          切换到 Raw
        </button>
      </div>
    </div>
  );
}

function ContentTextarea({
  value,
  isEditing,
  onChange,
}: {
  value: string;
  isEditing: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <OverlayScrollbarsComponent element="div" className="editor-body" options={OS_OPTIONS} defer>
      <textarea
        className="editor-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={!isEditing}
        aria-label="节点内容"
        spellCheck={false}
      />
    </OverlayScrollbarsComponent>
  );
}

function formatJson(value: string): { ok: true; formatted: string } | { ok: false } {
  try {
    return { ok: true, formatted: JSON.stringify(JSON.parse(value), null, 2) };
  } catch {
    return { ok: false };
  }
}

function formatXml(raw: string): string {
  const INDENT = "  ";
  let level = 0;
  let result = "";
  raw
    .replace(/(>)(<)(\/*)/g, "$1\n$2$3")
    .split("\n")
    .forEach((node) => {
      const trimmed = node.trim();
      if (!trimmed) return;
      if (trimmed.match(/^<\/\w/)) level = Math.max(0, level - 1);
      result += INDENT.repeat(level) + trimmed + "\n";
      if (trimmed.match(/^<\w[^>]*[^/]>.*$/) && !trimmed.match(/<.*>.*<\/.*>/)) level++;
    });
  return result.trim();
}

function parseXml(value: string): { ok: true; formatted: string } | { ok: false } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(value, "application/xml");
  if (doc.querySelector("parsererror")) return { ok: false };
  return { ok: true, formatted: formatXml(value) };
}

export function NodeContentPanel({
  value,
  viewMode,
  isEditing,
  onChange,
  onFallbackToRaw,
}: NodeContentPanelProps) {
  if (viewMode === "json") {
    if (isEditing) {
      // In edit mode: skip formatting to prevent cursor jumps on partial input
      return <ContentTextarea value={value} isEditing={true} onChange={onChange} />;
    }
    const result = formatJson(value);
    if (!result.ok) {
      return (
        <ParseErrorPanel
          mode="JSON"
          onFallbackToRaw={onFallbackToRaw}
        />
      );
    }
    return (
      <ContentTextarea value={result.formatted} isEditing={false} onChange={onChange} />
    );
  }

  if (viewMode === "xml") {
    if (isEditing) {
      // In edit mode: skip formatting to prevent cursor jumps on partial input
      return <ContentTextarea value={value} isEditing={true} onChange={onChange} />;
    }
    const result = parseXml(value);
    if (!result.ok) {
      return (
        <ParseErrorPanel
          mode="XML"
          onFallbackToRaw={onFallbackToRaw}
        />
      );
    }
    return (
      <ContentTextarea value={result.formatted} isEditing={false} onChange={onChange} />
    );
  }

  // Raw mode
  return (
    <ContentTextarea value={value} isEditing={isEditing} onChange={onChange} />
  );
}
