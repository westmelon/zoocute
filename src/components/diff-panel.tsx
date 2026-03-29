import { OverlayScrollbarsComponent } from "overlayscrollbars-react";

interface DiffPanelProps {
  original: string;
  draft: string;
}

type DiffLine =
  | { kind: "unchanged"; text: string }
  | { kind: "removed"; text: string }
  | { kind: "added"; text: string };

/**
 * Compute a simple line-level diff (no external library needed).
 * Uses a basic LCS approach via dynamic programming.
 */
function computeLineDiff(original: string, draft: string): DiffLine[] {
  const origLines = original.split("\n");
  const draftLines = draft.split("\n");

  const m = origLines.length;
  const n = draftLines.length;

  // Build LCS table
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (origLines[i - 1] === draftLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const result: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === draftLines[j - 1]) {
      result.unshift({ kind: "unchanged", text: origLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      result.unshift({ kind: "added", text: draftLines[j - 1] });
      j--;
    } else {
      result.unshift({ kind: "removed", text: origLines[i - 1] });
      i--;
    }
  }

  return result;
}

export function DiffPanel({ original, draft }: DiffPanelProps) {
  const lines = computeLineDiff(original, draft);

  return (
    <OverlayScrollbarsComponent
      element="div"
      className="diff-panel"
      options={{ scrollbars: { theme: "os-theme-dark", autoHide: "scroll", autoHideDelay: 800 } }}
      defer
    >
      <div className="diff-header">
        <span className="diff-label diff-label--original">原始内容</span>
        <span className="diff-label diff-label--draft">当前草稿</span>
      </div>
      <pre className="diff-body">
        {lines.map((line, idx) => (
          <div
            key={`${idx}-${line.kind}-${line.text.slice(0, 20)}`}
            className={
              line.kind === "added"
                ? "diff-line diff-line--added"
                : line.kind === "removed"
                  ? "diff-line diff-line--removed"
                  : "diff-line"
            }
          >
            <span className="diff-gutter">
              {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
            </span>
            {line.text}
          </div>
        ))}
      </pre>
    </OverlayScrollbarsComponent>
  );
}
