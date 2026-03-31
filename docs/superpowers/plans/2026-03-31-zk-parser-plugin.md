# ZooKeeper Parser Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fixed-directory parser plugins that accept ZooKeeper node bytes on `stdin`, return plain-text output on `stdout`, and surface the result in a new `PLUGIN` editor tab without replacing the current view on failure.

**Architecture:** Keep plugin execution in the Tauri backend. The frontend only lists available plugins, lets the user choose one, and switches the editor into a single `plugin` result view after a successful run. The backend discovers plugin manifests from an app-local plugins directory, executes the configured command in the plugin directory, feeds node bytes through `stdin`, and returns plain text plus structured errors.

**Tech Stack:** React 19 + Vitest, Tauri 2, Rust 2021, `std::process::Command`, ZooKeeper client cache/read path already present in `LiveAdapter`.

---

### Task 1: Add Backend Plugin Discovery

**Files:**
- Create: `src-tauri/src/parser_plugins.rs`
- Create: `src-tauri/tests/parser_plugins_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Write the failing Rust discovery tests**

```rust
// src-tauri/tests/parser_plugins_tests.rs
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use zoocute_lib::parser_plugins::{discover_plugins, ParserPluginManifest};

fn temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let dir = std::env::temp_dir().join(format!("zoocute-{name}-{suffix}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn discovers_enabled_plugins_from_child_directories() {
    let root = temp_dir("plugin-discovery");
    let plugin_dir = root.join("dubbo");
    fs::create_dir_all(&plugin_dir).unwrap();
    fs::write(
        plugin_dir.join("plugin.json"),
        r#"{
            "id":"dubbo-provider",
            "name":"Dubbo Provider Decoder",
            "enabled":true,
            "command":"java",
            "args":["-jar","parser.jar"]
        }"#,
    )
    .unwrap();

    let plugins = discover_plugins(&root).expect("plugins should load");

    assert_eq!(plugins.len(), 1);
    assert_eq!(plugins[0].manifest.id, "dubbo-provider");
    assert_eq!(plugins[0].manifest.name, "Dubbo Provider Decoder");
}

#[test]
fn skips_disabled_plugins() {
    let root = temp_dir("plugin-disabled");
    let plugin_dir = root.join("disabled");
    fs::create_dir_all(&plugin_dir).unwrap();
    fs::write(
        plugin_dir.join("plugin.json"),
        r#"{
            "id":"disabled",
            "name":"Disabled",
            "enabled":false,
            "command":"java",
            "args":["-jar","parser.jar"]
        }"#,
    )
    .unwrap();

    let plugins = discover_plugins(&root).expect("plugins should load");

    assert!(plugins.is_empty());
}

#[test]
fn rejects_manifest_without_id() {
    let root = temp_dir("plugin-invalid");
    let plugin_dir = root.join("invalid");
    fs::create_dir_all(&plugin_dir).unwrap();
    fs::write(
        plugin_dir.join("plugin.json"),
        r#"{
            "name":"Broken",
            "enabled":true,
            "command":"java",
            "args":["-jar","parser.jar"]
        }"#,
    )
    .unwrap();

    let error = discover_plugins(&root).expect_err("manifest should fail");
    assert!(error.contains("id"));
}
```

- [ ] **Step 2: Run the discovery tests to verify they fail**

Run: `cargo test --test parser_plugins_tests --manifest-path src-tauri/Cargo.toml`

Expected: FAIL with unresolved import for `zoocute_lib::parser_plugins` and missing `discover_plugins`.

- [ ] **Step 3: Implement plugin manifest parsing and discovery**

```rust
// src-tauri/src/parser_plugins.rs
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct ParserPluginManifest {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ParserPluginDto {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct ParserPluginDefinition {
    pub manifest: ParserPluginManifest,
    pub directory: PathBuf,
}

pub fn discover_plugins(root: &Path) -> Result<Vec<ParserPluginDefinition>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut definitions = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("plugin.json");
        if !manifest_path.exists() {
            continue;
        }

        let raw = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
        let manifest: ParserPluginManifest =
            serde_json::from_str(&raw).map_err(|e| format!("{}: {e}", manifest_path.display()))?;

        if manifest.id.trim().is_empty() {
            return Err(format!("{}: id must not be empty", manifest_path.display()));
        }
        if manifest.name.trim().is_empty() {
            return Err(format!("{}: name must not be empty", manifest_path.display()));
        }
        if manifest.command.trim().is_empty() {
            return Err(format!("{}: command must not be empty", manifest_path.display()));
        }
        if !manifest.enabled {
            continue;
        }

        definitions.push(ParserPluginDefinition {
            manifest,
            directory: path,
        });
    }

    definitions.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
    Ok(definitions)
}

pub fn to_dtos(definitions: &[ParserPluginDefinition]) -> Vec<ParserPluginDto> {
    definitions
        .iter()
        .map(|definition| ParserPluginDto {
            id: definition.manifest.id.clone(),
            name: definition.manifest.name.clone(),
        })
        .collect()
}
```

- [ ] **Step 4: Expose the new backend module**

```rust
// src-tauri/src/lib.rs
pub mod commands;
pub mod domain;
pub mod logging;
pub mod parser_plugins;
pub mod zk_core;
```

- [ ] **Step 5: Run the discovery tests to verify they pass**

Run: `cargo test --test parser_plugins_tests --manifest-path src-tauri/Cargo.toml`

Expected: PASS with 3 passed tests.

- [ ] **Step 6: Commit the discovery foundation**

```bash
git add src-tauri/src/lib.rs src-tauri/src/parser_plugins.rs src-tauri/tests/parser_plugins_tests.rs src-tauri/Cargo.toml
git commit -m "feat: add parser plugin discovery"
```

### Task 2: Add Tauri Commands for Listing and Running Plugins

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/domain.rs`
- Modify: `src-tauri/src/zk_core/live.rs`
- Create: `src-tauri/tests/parser_plugin_command_tests.rs`
- Modify: `src-tauri/src/parser_plugins.rs`

- [ ] **Step 1: Write the failing Rust command tests**

```rust
// src-tauri/tests/parser_plugin_command_tests.rs
use std::fs;
use std::path::PathBuf;

use zoocute_lib::parser_plugins::{discover_plugins, run_plugin_with_bytes};

#[test]
fn runs_plugin_and_collects_stdout() {
    let root = std::env::temp_dir().join("zoocute-parser-runner");
    let plugin_dir = root.join("echoer");
    fs::create_dir_all(&plugin_dir).unwrap();
    fs::write(
        plugin_dir.join("plugin.json"),
        r#"{
            "id":"echoer",
            "name":"Echoer",
            "enabled":true,
            "command":"powershell",
            "args":["-NoProfile","-Command","$bytes = [Console]::OpenStandardInput(); $reader = New-Object System.IO.BinaryReader($bytes); $data = $reader.ReadBytes(4); [Console]::Out.Write([System.BitConverter]::ToString($data))"]
        }"#,
    )
    .unwrap();

    let plugin = discover_plugins(&root).unwrap().remove(0);
    let output = run_plugin_with_bytes(&plugin, &[0xDE, 0xAD, 0xBE, 0xEF], 5000).unwrap();

    assert_eq!(output.stdout.trim(), "DE-AD-BE-EF");
}

#[test]
fn returns_non_zero_exit_as_error() {
    let root = std::env::temp_dir().join("zoocute-parser-fail");
    let plugin_dir = root.join("broken");
    fs::create_dir_all(&plugin_dir).unwrap();
    fs::write(
        plugin_dir.join("plugin.json"),
        r#"{
            "id":"broken",
            "name":"Broken",
            "enabled":true,
            "command":"powershell",
            "args":["-NoProfile","-Command","Write-Error 'boom'; exit 7"]
        }"#,
    )
    .unwrap();

    let plugin = discover_plugins(&root).unwrap().remove(0);
    let error = run_plugin_with_bytes(&plugin, &[1, 2, 3], 5000).expect_err("plugin should fail");

    assert!(error.contains("exit code 7"));
}
```

- [ ] **Step 2: Run the command tests to verify they fail**

Run: `cargo test --test parser_plugin_command_tests --manifest-path src-tauri/Cargo.toml`

Expected: FAIL with missing `run_plugin_with_bytes`.

- [ ] **Step 3: Implement plugin execution and Tauri DTOs**

```rust
// src-tauri/src/domain.rs
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParserPluginRunResultDto {
    pub plugin_id: String,
    pub plugin_name: String,
    pub content: String,
    pub generated_at: i64,
}
```

```rust
// src-tauri/src/parser_plugins.rs
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct PluginExecutionOutput {
    pub stdout: String,
}

pub fn run_plugin_with_bytes(
    plugin: &ParserPluginDefinition,
    bytes: &[u8],
    _timeout_ms: u64,
) -> Result<PluginExecutionOutput, String> {
    let mut child = Command::new(&plugin.manifest.command)
        .args(&plugin.manifest.args)
        .current_dir(&plugin.directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start plugin {}: {e}", plugin.manifest.name))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(bytes).map_err(|e| e.to_string())?;
    }

    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let code = output.status.code().unwrap_or(-1);
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "plugin {} failed with exit code {}{}",
            plugin.manifest.name,
            code,
            if stderr.is_empty() { "".to_string() } else { format!(": {stderr}") }
        ));
    }

    Ok(PluginExecutionOutput {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
    })
}
```

```rust
// src-tauri/src/commands.rs
#[tauri::command]
pub fn list_parser_plugins(state: State<'_, AppState>) -> Result<Vec<crate::parser_plugins::ParserPluginDto>, String> {
    let plugin_root = state.plugin_root();
    let definitions = crate::parser_plugins::discover_plugins(&plugin_root)?;
    Ok(crate::parser_plugins::to_dtos(&definitions))
}

#[tauri::command]
pub fn run_parser_plugin(
    connection_id: String,
    path: String,
    plugin_id: String,
    state: State<'_, AppState>,
) -> Result<crate::domain::ParserPluginRunResultDto, String> {
    let adapter = {
        let sessions = state.sessions.lock().map_err(|_| "failed to acquire sessions lock".to_string())?;
        sessions.get(&connection_id).cloned()
    };
    let adapter = adapter.ok_or_else(|| format!("no active session for connection {connection_id}"))?;

    let plugin_root = state.plugin_root();
    let definitions = crate::parser_plugins::discover_plugins(&plugin_root)?;
    let plugin = definitions
        .into_iter()
        .find(|definition| definition.manifest.id == plugin_id)
        .ok_or_else(|| format!("plugin not found: {plugin_id}"))?;

    let bytes = adapter.get_node_bytes(&path)?;
    let output = crate::parser_plugins::run_plugin_with_bytes(&plugin, &bytes, 5000)?;

    Ok(crate::domain::ParserPluginRunResultDto {
        plugin_id: plugin.manifest.id,
        plugin_name: plugin.manifest.name,
        content: output.stdout,
        generated_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64,
    })
}
```

- [ ] **Step 4: Add a raw-byte read helper to `LiveAdapter`**

```rust
// src-tauri/src/commands.rs
impl AppState {
    pub fn plugin_root(&self) -> PathBuf {
        self.app_handle
            .as_ref()
            .and_then(|app| app.path().app_data_dir().ok())
            .unwrap_or_else(|| PathBuf::from("."))
            .join("plugins")
    }
}
```

```rust
// src-tauri/src/zk_core/live.rs
impl LiveAdapter {
    pub fn get_node_bytes(&self, path: &str) -> Result<Vec<u8>, String> {
        let watcher = DataWatcher {
            client: Arc::downgrade(&self.client),
            app_handle: self.app_handle.clone(),
            connection_id: self.connection_id.clone(),
            path: path.to_string(),
            log_store: Arc::clone(&self.log_store),
            active_paths: Arc::clone(&self.data_watch_paths),
            shutdown: Arc::clone(&self.shutdown),
        };
        let (data, _stat) = register_data_watch(&watcher)?;
        Ok(data)
    }
}
```

- [ ] **Step 5: Register the new invoke handlers**

```rust
// src-tauri/src/lib.rs
use commands::{
    clear_zk_logs, connect_server, create_node, delete_node, disconnect_server,
    get_node_details, get_tree_snapshot, list_children, list_parser_plugins,
    load_full_tree, read_zk_logs, run_parser_plugin, save_node, AppState,
};

// inside generate_handler!
list_parser_plugins,
run_parser_plugin,
```

- [ ] **Step 6: Run the backend plugin tests to verify they pass**

Run: `cargo test --test parser_plugins_tests --test parser_plugin_command_tests --manifest-path src-tauri/Cargo.toml`

Expected: PASS with both test targets succeeding.

- [ ] **Step 7: Commit the Tauri command layer**

```bash
git add src-tauri/src/commands.rs src-tauri/src/domain.rs src-tauri/src/lib.rs src-tauri/src/parser_plugins.rs src-tauri/src/zk_core/live.rs src-tauri/tests/parser_plugin_command_tests.rs
git commit -m "feat: add parser plugin tauri commands"
```

### Task 3: Add Frontend Types and Command Client

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/commands.ts`
- Modify: `src/lib/mock-data.ts`
- Modify: `src/use-workbench-state.test.tsx`
- Modify: `src/use-workbench-watch.test.tsx`

- [ ] **Step 1: Write the failing frontend command type expectations**

```ts
// src/use-workbench-state.test.tsx
import { expect, it } from "vitest";
import type { ParserPlugin, ParserPluginResult } from "./lib/types";

it("exposes parser plugin types for the editor flow", () => {
  const plugin: ParserPlugin = { id: "dubbo-provider", name: "Dubbo Provider Decoder" };
  const result: ParserPluginResult = {
    pluginId: "dubbo-provider",
    pluginName: "Dubbo Provider Decoder",
    content: "decoded output",
    generatedAt: 1,
  };

  expect(plugin.name).toContain("Decoder");
  expect(result.content).toBe("decoded output");
});
```

- [ ] **Step 2: Run the frontend tests to verify they fail**

Run: `npm test -- src/use-workbench-state.test.tsx`

Expected: FAIL because `ParserPlugin` and `ParserPluginResult` do not exist.

- [ ] **Step 3: Add frontend plugin types and invoke wrappers**

```ts
// src/lib/types.ts
export type ViewMode = "raw" | "json" | "xml" | "plugin";

export interface ParserPlugin {
  id: string;
  name: string;
}

export interface ParserPluginResult {
  pluginId: string;
  pluginName: string;
  content: string;
  generatedAt: number;
}
```

```ts
// src/lib/commands.ts
import type {
  ConnectionResult,
  NodeDetails,
  NodeTreeItem,
  ParserPlugin,
  ParserPluginResult,
  TreeSnapshot,
  ZkLogEntry,
} from "./types";

export async function listParserPlugins(): Promise<ParserPlugin[]> {
  return invoke("list_parser_plugins");
}

export async function runParserPlugin(
  connectionId: string,
  path: string,
  pluginId: string
): Promise<ParserPluginResult> {
  return invoke("run_parser_plugin", { connectionId, path, pluginId });
}
```

- [ ] **Step 4: Update mock/test fixtures that depend on `ViewMode` or `NodeDetails`**

```ts
// src/lib/mock-data.ts
export const parserPlugins: ParserPlugin[] = [
  { id: "dubbo-provider", name: "Dubbo Provider Decoder" },
  { id: "hessian-decoder", name: "Hessian Decoder" },
];
```

- [ ] **Step 5: Run the focused frontend tests to verify they pass**

Run: `npm test -- src/use-workbench-state.test.tsx src/use-workbench-watch.test.tsx`

Expected: PASS with the existing hook tests still green.

- [ ] **Step 6: Commit the shared frontend contract**

```bash
git add src/lib/types.ts src/lib/commands.ts src/lib/mock-data.ts src/use-workbench-state.test.tsx src/use-workbench-watch.test.tsx
git commit -m "feat: add parser plugin frontend contracts"
```

### Task 4: Add Toolbar and Content Rendering for Plugin Results

**Files:**
- Modify: `src/components/editor-toolbar.tsx`
- Modify: `src/components/editor-toolbar.test.tsx`
- Modify: `src/components/node-content-panel.tsx`
- Modify: `src/components/node-content-panel.test.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Write failing toolbar and content tests**

```tsx
// src/components/editor-toolbar.test.tsx
it("shows parser plugin selector and parse action", () => {
  render(
    <EditorToolbar
      {...defaultProps}
      plugins={[{ id: "dubbo-provider", name: "Dubbo Provider Decoder" }]}
      selectedPluginId="dubbo-provider"
      onPluginChange={vi.fn()}
      onParsePlugin={vi.fn()}
      pluginResultAvailable={false}
      isPluginParsing={false}
    />
  );

  expect(screen.getByLabelText("Plugin")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Parse" })).toBeInTheDocument();
});

it("shows plugin tab only after a parse result exists", () => {
  render(
    <EditorToolbar
      {...defaultProps}
      viewMode="plugin"
      plugins={[{ id: "dubbo-provider", name: "Dubbo Provider Decoder" }]}
      selectedPluginId="dubbo-provider"
      onPluginChange={vi.fn()}
      onParsePlugin={vi.fn()}
      pluginResultAvailable={true}
      isPluginParsing={false}
    />
  );

  expect(screen.getByRole("button", { name: "PLUGIN" })).toBeInTheDocument();
});
```

```tsx
// src/components/node-content-panel.test.tsx
it("shows plugin output in plugin mode", () => {
  render(
    <NodeContentPanel
      value="raw"
      pluginContent="decoded output"
      viewMode="plugin"
      isEditing={false}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );

  expect(screen.getByRole("textbox")).toHaveValue("decoded output");
});
```

- [ ] **Step 2: Run the component tests to verify they fail**

Run: `npm test -- src/components/editor-toolbar.test.tsx src/components/node-content-panel.test.tsx`

Expected: FAIL because plugin props and plugin mode do not exist.

- [ ] **Step 3: Implement toolbar props, plugin tab, and parse controls**

```tsx
// src/components/editor-toolbar.tsx
interface EditorToolbarProps {
  // existing props...
  plugins: ParserPlugin[];
  selectedPluginId: string;
  onPluginChange: (pluginId: string) => void;
  onParsePlugin: () => void;
  pluginResultAvailable: boolean;
  isPluginParsing: boolean;
}

const VIEW_MODES: { value: ViewMode; label: string; requiresResult?: boolean }[] = [
  { value: "raw", label: "RAW" },
  { value: "json", label: "JSON" },
  { value: "xml", label: "XML" },
  { value: "plugin", label: "PLUGIN", requiresResult: true },
];

{VIEW_MODES.filter((mode) => !mode.requiresResult || pluginResultAvailable).map((m, index, visibleModes) => (
  <div key={m.value} className="toolbar-view-segment">
    <button
      type="button"
      className={`toolbar-tab${viewMode === m.value ? " active" : ""}`}
      onClick={() => onViewModeChange(m.value)}
      aria-pressed={viewMode === m.value}
      disabled={isEditing}
    >
      {m.label}
    </button>
    {index < visibleModes.length - 1 ? <span className="toolbar-view-divider" aria-hidden="true" /> : null}
  </div>
))}

<select
  aria-label="Plugin"
  className="toolbar-plugin-select"
  value={selectedPluginId}
  onChange={(e) => onPluginChange(e.target.value)}
>
  <option value="">Select plugin</option>
  {plugins.map((plugin) => (
    <option key={plugin.id} value={plugin.id}>{plugin.name}</option>
  ))}
</select>

<button
  type="button"
  className="btn"
  onClick={onParsePlugin}
  disabled={!selectedPluginId || isPluginParsing}
>
  {isPluginParsing ? "Parsing..." : "Parse"}
</button>
```

- [ ] **Step 4: Implement plugin rendering in the content panel**

```tsx
// src/components/node-content-panel.tsx
interface NodeContentPanelProps {
  value: string;
  pluginContent?: string | null;
  viewMode: ViewMode;
  isEditing: boolean;
  onChange: (value: string) => void;
  onFallbackToRaw: () => void;
}

export function NodeContentPanel({
  value,
  pluginContent,
  viewMode,
  isEditing,
  onChange,
  onFallbackToRaw,
}: NodeContentPanelProps) {
  if (viewMode === "plugin") {
    return (
      <ContentTextarea
        value={pluginContent ?? ""}
        isEditing={false}
        onChange={onChange}
      />
    );
  }

  // existing raw/json/xml branches...
}
```

- [ ] **Step 5: Add minimal toolbar styling for plugin controls**

```css
/* src/styles/app.css */
.toolbar-plugin-select {
  min-width: 220px;
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
  color: var(--text-secondary);
}
```

- [ ] **Step 6: Re-run the component tests**

Run: `npm test -- src/components/editor-toolbar.test.tsx src/components/node-content-panel.test.tsx`

Expected: PASS with plugin-specific assertions succeeding.

- [ ] **Step 7: Commit the editor UI primitives**

```bash
git add src/components/editor-toolbar.tsx src/components/editor-toolbar.test.tsx src/components/node-content-panel.tsx src/components/node-content-panel.test.tsx src/styles/app.css
git commit -m "feat: add plugin result editor controls"
```

### Task 5: Wire Plugin State Into the Editor Flow

**Files:**
- Modify: `src/components/editor-panel.tsx`
- Modify: `src/editor-panel.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/hooks/use-workbench-state.ts`

- [ ] **Step 1: Write failing editor integration tests**

```tsx
// src/editor-panel.test.tsx
it("switches to plugin mode after a successful parse", async () => {
  const user = userEvent.setup();
  const listPlugins = vi.fn().mockResolvedValue([{ id: "dubbo-provider", name: "Dubbo Provider Decoder" }]);
  const runPlugin = vi.fn().mockResolvedValue({
    pluginId: "dubbo-provider",
    pluginName: "Dubbo Provider Decoder",
    content: "decoded payload",
    generatedAt: 1,
  });

  render(
    <EditorPanel
      {...defaultProps}
      node={binaryNode}
      connectionId="conn-a"
      nodePath="/services/session_blob"
      onListParserPlugins={listPlugins}
      onRunParserPlugin={runPlugin}
      onPluginError={vi.fn()}
    />
  );

  await user.selectOptions(screen.getByLabelText("Plugin"), "dubbo-provider");
  await user.click(screen.getByRole("button", { name: "Parse" }));

  expect(await screen.findByRole("button", { name: "PLUGIN" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("textbox")).toHaveValue("decoded payload");
});

it("keeps the current view when plugin parsing fails", async () => {
  const user = userEvent.setup();
  const onPluginError = vi.fn();

  render(
    <EditorPanel
      {...defaultProps}
      node={binaryNode}
      connectionId="conn-a"
      nodePath="/services/session_blob"
      onListParserPlugins={vi.fn().mockResolvedValue([{ id: "dubbo-provider", name: "Dubbo Provider Decoder" }])}
      onRunParserPlugin={vi.fn().mockRejectedValue(new Error("exit code 7"))}
      onPluginError={onPluginError}
    />
  );

  await user.selectOptions(screen.getByLabelText("Plugin"), "dubbo-provider");
  await user.click(screen.getByRole("button", { name: "Parse" }));

  expect(screen.getByRole("button", { name: "RAW" })).toHaveAttribute("aria-pressed", "true");
  expect(onPluginError).toHaveBeenCalledWith("exit code 7");
});
```

- [ ] **Step 2: Run the editor integration tests to verify they fail**

Run: `npm test -- src/editor-panel.test.tsx`

Expected: FAIL because `EditorPanel` has no parser plugin props or behavior.

- [ ] **Step 3: Add plugin state and async actions to `EditorPanel`**

```tsx
// src/components/editor-panel.tsx
interface EditorPanelProps {
  // existing props...
  connectionId: string;
  nodePath: string;
  onListParserPlugins: () => Promise<ParserPlugin[]>;
  onRunParserPlugin: (connectionId: string, path: string, pluginId: string) => Promise<ParserPluginResult>;
  onPluginError: (message: string) => void;
}

const [plugins, setPlugins] = useState<ParserPlugin[]>([]);
const [selectedPluginId, setSelectedPluginId] = useState("");
const [pluginResult, setPluginResult] = useState<ParserPluginResult | null>(null);
const [isPluginParsing, setIsPluginParsing] = useState(false);

useEffect(() => {
  let cancelled = false;
  void onListParserPlugins().then((loaded) => {
    if (!cancelled) setPlugins(loaded);
  }).catch(() => {
    if (!cancelled) setPlugins([]);
  });
  return () => { cancelled = true; };
}, [nodePath, onListParserPlugins]);

async function handleParsePlugin() {
  if (!selectedPluginId) {
    onPluginError("请先选择插件");
    return;
  }

  setIsPluginParsing(true);
  try {
    const result = await onRunParserPlugin(connectionId, nodePath, selectedPluginId);
    setPluginResult(result);
    setViewMode("plugin");
    setShowDiff(false);
  } catch (error) {
    onPluginError(error instanceof Error ? error.message : "插件解析失败");
  } finally {
    setIsPluginParsing(false);
  }
}
```

- [ ] **Step 4: Wire App/hook callbacks into the editor**

```tsx
// src/App.tsx
<EditorPanel
  key={activePath ?? ""}
  connectionId={activeTabId ?? ""}
  nodePath={activePath ?? ""}
  onListParserPlugins={listParserPlugins}
  onRunParserPlugin={runParserPlugin}
  onPluginError={showConnectionError}
  // existing props...
/>
```

```ts
// src/hooks/use-workbench-state.ts
function showConnectionError(message: string) {
  setConnectionError(message);
}

return {
  // existing fields...
  showConnectionError,
};
```

- [ ] **Step 5: Re-run the editor integration tests**

Run: `npm test -- src/editor-panel.test.tsx`

Expected: PASS with successful-parse and failed-parse flows both covered.

- [ ] **Step 6: Commit the wired editor flow**

```bash
git add src/components/editor-panel.tsx src/editor-panel.test.tsx src/App.tsx src/hooks/use-workbench-state.ts
git commit -m "feat: wire parser plugin flow into editor"
```

### Task 6: Full Verification and Cleanup

**Files:**
- Modify: `docs/superpowers/specs/2026-03-31-zk-parser-plugin-design.md` (only if implementation decisions diverge)
- Modify: any touched files from Tasks 1-5

- [ ] **Step 1: Run the frontend test suite**

Run: `npm test`

Expected: PASS with all Vitest suites green.

- [ ] **Step 2: Run the Rust test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS with parser plugin tests included and no regressions in existing backend tests.

- [ ] **Step 3: Run the production frontend build**

Run: `npm run build`

Expected: PASS with TypeScript compilation and Vite bundle complete.

- [ ] **Step 4: Self-review against the spec**

```text
Checklist:
- Toolbar shows plugin selector + Parse + conditional PLUGIN tab
- Backend discovers fixed-directory plugins
- Backend writes node bytes to stdin
- Success switches to PLUGIN view with plain-text output
- Failure keeps current view and shows an error
- Node switches clear plugin results
```

- [ ] **Step 5: Commit the verification pass**

```bash
git add src src-tauri docs/superpowers/specs/2026-03-31-zk-parser-plugin-design.md
git commit -m "test: verify parser plugin integration"
```
