import type { NodeDetails } from "../lib/types";

interface NodeStatProps {
  node: NodeDetails;
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function NodeStat({ node }: NodeStatProps) {
  return (
    <div className="node-stat">
      <div className="stat-entry">
        <span className="stat-key">dataVersion</span>
        <span className="stat-val">{node.version}</span>
      </div>
      <div className="stat-entry">
        <span className="stat-key">cVersion</span>
        <span className="stat-val">{node.cVersion}</span>
      </div>
      <div className="stat-entry">
        <span className="stat-key">aclVersion</span>
        <span className="stat-val">{node.aclVersion}</span>
      </div>
      <div className="stat-entry">
        <span className="stat-key">numChildren</span>
        <span className="stat-val">{node.childrenCount}</span>
      </div>
      <div className="stat-entry">
        <span className="stat-key">dataLength</span>
        <span className="stat-val">{node.dataLength}</span>
      </div>
      <div className="stat-entry">
        <span className="stat-key">ephemeral</span>
        <span className="stat-val">{node.ephemeral ? "是" : "否"}</span>
      </div>
      <div className="stat-entry">
        <span className="stat-key">mZxid</span>
        <span className="stat-val stat-val--zxid">{node.mZxid ?? "—"}</span>
      </div>
      <div className="stat-entry">
        <span className="stat-key">cZxid</span>
        <span className="stat-val stat-val--zxid">{node.cZxid ?? "—"}</span>
      </div>
      <div className="stat-entry stat-entry--wide">
        <span className="stat-key">mtime</span>
        <span className="stat-val">{node.mTime ? formatDate(node.mTime) : node.updatedAt}</span>
      </div>
      <div className="stat-entry stat-entry--wide">
        <span className="stat-key">ctime</span>
        <span className="stat-val">{node.cTime ? formatDate(node.cTime) : "—"}</span>
      </div>
    </div>
  );
}
