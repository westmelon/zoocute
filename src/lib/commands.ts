import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  ConnectionResult,
  NodeDetails,
  NodeTreeItem,
  ParserPlugin,
  ParserPluginResult,
  ThemePreference,
  TreeSnapshot,
  WriteMode,
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

export async function getAppSettings(): Promise<AppSettings> {
  return invoke("get_app_settings");
}

export async function setThemePreference(theme: ThemePreference): Promise<AppSettings> {
  return invoke("set_theme_preference", { theme });
}

export async function setWriteMode(writeMode: WriteMode): Promise<AppSettings> {
  return invoke("set_write_mode", { writeMode });
}

export async function choosePluginDirectory(): Promise<AppSettings | null> {
  return invoke("choose_plugin_directory");
}

export async function resetPluginDirectory(): Promise<AppSettings> {
  return invoke("reset_plugin_directory");
}

export async function getEffectivePluginDirectory(): Promise<string> {
  return invoke("get_effective_plugin_directory");
}

export async function openPluginDirectory(): Promise<void> {
  await invoke("open_plugin_directory");
}

export async function listParserPlugins(): Promise<ParserPlugin[]> {
  return invoke("list_parser_plugins");
}

export async function runParserPlugin(
  connectionId: string,
  path: string,
  pluginId: string
): Promise<ParserPluginResult> {
  return invoke("run_parser_plugin", {
    connectionId,
    path,
    pluginId,
  });
}
