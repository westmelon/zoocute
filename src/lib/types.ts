export type ConnectionStatus = "connected" | "degraded";
export type AuthMode = "anonymous" | "digest";

export interface ConnectionSummary {
  id: string;
  name: string;
  status: ConnectionStatus;
  region: string;
}

export interface NodeTreeItem {
  path: string;
  name: string;
  hasChildren?: boolean;
  children?: NodeTreeItem[];
}

export type NodeFormatHint = "text" | "binary" | "unknown";
export type DataKind = "json" | "text" | "cautious" | "binary";

export interface NodeDetails {
  path: string;
  value: string;
  formatHint?: NodeFormatHint;
  dataKind: DataKind;
  displayModeLabel: string;
  editable: boolean;
  rawPreview: string;
  decodedPreview: string;
  version: number;
  childrenCount: number;
  updatedAt: string;
  cVersion: number;
  aclVersion: number;
  cZxid: string | null;
  mZxid: string | null;
  cTime: number;
  mTime: number;
  dataLength: number;
  ephemeral: boolean;
}

export interface CachedNode {
  path: string;
  name: string;
  parentPath: string | null;
  hasChildren: boolean;
  hasLoadedChildren: boolean;
}

export interface SearchResult {
  path: string;
  name: string;
}

export type SearchMode = "tree" | "results";

export type RibbonMode = "browse" | "connections" | "log";
export type ViewMode = "raw" | "json" | "xml";
export type Charset = "UTF-8" | "GBK" | "ISO-8859-1";

export interface SavedConnection {
  id: string;
  name: string;
  connectionString: string;
  username?: string;
  password?: string;
  timeoutMs: number;
}

export interface WorkbenchState {
  openTabs: string[];
  activePath: string;
  recentPaths: string[];
  activeNode: NodeDetails;
}

export interface InterpretedNodeData {
  kind: DataKind;
  modeLabel: string;
  editable: boolean;
  helperText: string | null;
}

export interface ConnectionFormState {
  connectionString: string;
  username: string;
  password: string;
}

export interface ZkLogEntry {
  timestamp: number;        // Unix millis
  level: "DEBUG" | "ERROR";
  connectionId: string | null;
  operation: string;
  path: string | null;
  success: boolean;
  durationMs: number;
  message: string;
  error: string | null;
  meta: Record<string, unknown> | null;
}

export interface ConnectionResult {
  connected: boolean;
  authMode: AuthMode;
  authSucceeded: boolean;
  message: string;
}

export interface WatchEvent {
  connectionId: string;
  eventType: "children_changed" | "data_changed" | "node_deleted" | "node_created";
  path: string;
}

export interface ActiveSession {
  connection: SavedConnection;
  treeNodes: NodeTreeItem[];
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  activePath: string | null;
  activeNode: NodeDetails | null;
  drafts: Record<string, string>;
  editingPaths: Set<string>;
}
