import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionResult,
  NodeDetails,
  NodeTreeItem,
  TreeSnapshot,
  ZkLogEntry,
} from "./types";

export async function connectServer(
  connectionId: string,
  input: { connectionString: string; username?: string; password?: string }
): Promise<ConnectionResult> {
  return invoke("connect_server", {
    connectionId,
    request: {
      connectionString: input.connectionString,
      username: input.username || null,
      password: input.password || null,
    },
  });
}

export async function disconnectServer(connectionId: string): Promise<void> {
  return invoke("disconnect_server", { connectionId });
}

export async function listChildren(
  connectionId: string,
  path: string
): Promise<NodeTreeItem[]> {
  return invoke("list_children", { connectionId, path });
}

export async function getNodeDetails(
  connectionId: string,
  path: string
): Promise<NodeDetails> {
  return invoke("get_node_details", { connectionId, path });
}

export async function getTreeSnapshot(connectionId: string): Promise<TreeSnapshot> {
  return invoke("get_tree_snapshot", { connectionId });
}

export async function saveNode(
  connectionId: string,
  path: string,
  value: string
): Promise<void> {
  return invoke("save_node", { connectionId, path, value });
}

export async function createNode(
  connectionId: string,
  path: string,
  data: string
): Promise<void> {
  await invoke("create_node", { connectionId, path, data });
}

export async function deleteNode(
  connectionId: string,
  path: string,
  recursive: boolean
): Promise<void> {
  await invoke("delete_node", { connectionId, path, recursive });
}

export async function loadFullTree(connectionId: string): Promise<NodeTreeItem[]> {
  return invoke("load_full_tree", { connectionId });
}

export async function readZkLogs(limit?: number): Promise<ZkLogEntry[]> {
  return invoke("read_zk_logs", { limit: limit ?? null });
}

export async function clearZkLogs(): Promise<void> {
  await invoke("clear_zk_logs");
}
