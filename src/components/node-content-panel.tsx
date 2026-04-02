import { useEffect, useRef } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import type { Charset, ViewMode } from "../lib/types";

const OS_OPTIONS = {
  scrollbars: { theme: "os-theme-dark", autoHide: "scroll" as const, autoHideDelay: 800 },
} as const;

interface NodeContentPanelProps {
  value: string;
  rawPreview: string;
  charset: Charset;
  shouldDecodeSource: boolean;
  pluginContent?: string | null;
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function syncTextareaHeight() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  useEffect(() => {
    syncTextareaHeight();
  }, [value, isEditing]);

  useEffect(() => {
    const textarea = textareaRef.current;
    const host = textarea?.parentElement;
    if (!host || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      syncTextareaHeight();
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <OverlayScrollbarsComponent element="div" className="editor-body" options={OS_OPTIONS} defer>
      <textarea
        ref={textareaRef}
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

function hexToBytes(hex: string): Uint8Array | null {
  const normalized = hex.trim();
  if (normalized.length === 0) return new Uint8Array();
  if (normalized.length % 2 !== 0 || /[^0-9a-f]/i.test(normalized)) return null;

  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
}

function toDecoderLabel(charset: Charset): string {
  switch (charset) {
    case "GBK":
      return "gbk";
    case "ISO-8859-1":
      return "iso-8859-1";
    case "UTF-8":
    default:
      return "utf-8";
  }
}

function decodeRawValue(value: string, rawPreview: string, charset: Charset): string {
  const bytes = hexToBytes(rawPreview);
  if (!bytes) return value;

  try {
    return new TextDecoder(toDecoderLabel(charset)).decode(bytes);
  } catch {
    return value;
  }
}

export function NodeContentPanel({
  value,
  rawPreview,
  charset,
  shouldDecodeSource,
  pluginContent,
  viewMode,
  isEditing,
  onChange,
  onFallbackToRaw,
}: NodeContentPanelProps) {
  const displayValue = shouldDecodeSource ? decodeRawValue(value, rawPreview, charset) : value;

  if (viewMode === "plugin") {
    return (
      <ContentTextarea
        value={pluginContent ?? value}
        isEditing={false}
        onChange={onChange}
      />
    );
  }

  if (viewMode === "json") {
    if (isEditing) {
      // In edit mode: skip formatting to prevent cursor jumps on partial input
      return <ContentTextarea value={displayValue} isEditing={true} onChange={onChange} />;
    }
    const result = formatJson(displayValue);
    if (!result.ok) {
      return <ParseErrorPanel mode="JSON" onFallbackToRaw={onFallbackToRaw} />;
    }
    return <ContentTextarea value={result.formatted} isEditing={false} onChange={onChange} />;
  }

  if (viewMode === "xml") {
    if (isEditing) {
      // In edit mode: skip formatting to prevent cursor jumps on partial input
      return <ContentTextarea value={displayValue} isEditing={true} onChange={onChange} />;
    }
    const result = parseXml(displayValue);
    if (!result.ok) {
      return <ParseErrorPanel mode="XML" onFallbackToRaw={onFallbackToRaw} />;
    }
    return <ContentTextarea value={result.formatted} isEditing={false} onChange={onChange} />;
  }

  return <ContentTextarea value={displayValue} isEditing={isEditing} onChange={onChange} />;
}
