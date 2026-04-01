# Windows Portable Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows-only portable mode with `exe_dir/zoo_data` storage, move saved connections out of frontend `localStorage`, and make the settings UI reflect portable-mode restrictions.

**Architecture:** Introduce a backend-owned runtime mode and data-root resolver, then derive every persisted path from that single source. Move connection persistence behind new Tauri commands backed by `connections.json`, while the frontend replaces `usePersistedConnections` with a backend-backed hook. Portable mode keeps using the same React and Rust codepaths, but changes defaults and UI affordances based on the reported runtime mode.

**Tech Stack:** React, TypeScript, Vitest, Tauri 2, Rust

---

### File Structure

**Backend files**
- Modify: `src-tauri/src/commands.rs`
  Responsibility: runtime mode, data root, settings/connections commands, portable plugin path policy
- Modify: `src-tauri/src/domain.rs`
  Responsibility: DTOs for runtime mode and saved connections
- Modify: `src-tauri/src/lib.rs`
  Responsibility: register new Tauri commands
- Create: `src-tauri/tests/runtime_mode_tests.rs`
  Responsibility: verify data root and portable mode path rules
- Create: `src-tauri/tests/connection_store_tests.rs`
  Responsibility: verify `connections.json` persistence and fallback behavior
- Modify: `src-tauri/tauri.conf.json`
  Responsibility: portable build identity or product-name split if needed by build approach

**Frontend files**
- Replace/Modify: `src/hooks/use-persisted-connections.ts`
  Responsibility: backend-backed connection store hook instead of direct `localStorage`
- Modify: `src/lib/commands.ts`
  Responsibility: wrappers for runtime mode and connection CRUD commands
- Modify: `src/lib/types.ts`
  Responsibility: runtime mode and saved-connection DTO types
- Modify: `src/App.tsx`
  Responsibility: load runtime mode, portable-mode UI behavior, use backend-backed connections
- Modify: `src/components/settings-panel.tsx`
  Responsibility: display portable badge and hide plugin path actions in portable mode
- Modify: `src/components/connection-pane.tsx`
  Responsibility: ensure connection editing works with backend-backed persistence

**Frontend tests**
- Modify: `src/App.test.tsx`
- Modify: `src/persisted-connections.test.ts`
- Create: `src/components/settings-panel-portable.test.tsx`

---

### Task 1: Add Backend Runtime Mode And Data Root Resolution

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/domain.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/runtime_mode_tests.rs`

- [ ] **Step 1: Write the failing backend runtime mode tests**

Create `src-tauri/tests/runtime_mode_tests.rs`:

```rust
use std::path::PathBuf;

use zoocute_lib::commands::{AppState, RuntimeMode};

#[test]
fn standard_mode_uses_app_data_root_paths() {
    let root = PathBuf::from("target/test-standard-root");
    let state = AppState::new_for_tests_with_runtime_mode(
        root.join("logs/zookeeper-debug.jsonl"),
        root.join("settings.json"),
        root.join("plugins"),
        root.join("connections.json"),
        RuntimeMode::Standard,
        root.clone(),
    );

    assert_eq!(state.runtime_mode(), RuntimeMode::Standard);
    assert_eq!(state.data_root(), root);
    assert_eq!(state.default_plugin_root(), PathBuf::from("target/test-standard-root/plugins"));
}

#[test]
fn portable_mode_uses_exe_dir_zoo_data() {
    let exe_dir = PathBuf::from("D:/portable/ZooCutePortable");
    let data_root = exe_dir.join("zoo_data");
    let state = AppState::new_for_tests_with_runtime_mode(
        data_root.join("logs/zookeeper-debug.jsonl"),
        data_root.join("settings.json"),
        data_root.join("plugins"),
        data_root.join("connections.json"),
        RuntimeMode::Portable,
        data_root.clone(),
    );

    assert_eq!(state.runtime_mode(), RuntimeMode::Portable);
    assert_eq!(state.data_root(), data_root);
    assert_eq!(state.plugin_root(), exe_dir.join("zoo_data/plugins"));
}
```

- [ ] **Step 2: Run the runtime mode test and verify it fails**

Run: `cd src-tauri; cargo test --test runtime_mode_tests --no-run`

Expected: FAIL because `RuntimeMode`, `data_root`, and the new constructor do not exist yet.

- [ ] **Step 3: Write the minimal runtime mode implementation**

Update `src-tauri/src/commands.rs` to add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeMode {
    Standard,
    Portable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfoDto {
    pub mode: String,
    pub data_root: String,
}
```

Extend `AppState` with:

```rust
runtime_mode: RuntimeMode,
data_root: PathBuf,
connections_path: PathBuf,
```

Add helpers:

```rust
pub fn runtime_mode(&self) -> RuntimeMode { ... }
pub fn data_root(&self) -> PathBuf { ... }
pub fn connections_path(&self) -> PathBuf { ... }
```

In `AppState::new`, derive mode and paths as:

```rust
let exe_path = app_handle.path().executable_path().unwrap_or_else(|_| PathBuf::from("."));
let exe_dir = exe_path.parent().unwrap_or_else(|| std::path::Path::new(".")).to_path_buf();
let is_portable = exe_path
    .file_stem()
    .and_then(|name| name.to_str())
    .map(|name| name.eq_ignore_ascii_case("ZooCutePortable"))
    .unwrap_or(false);

let (runtime_mode, data_root) = if is_portable {
    (RuntimeMode::Portable, exe_dir.join("zoo_data"))
} else {
    (RuntimeMode::Standard, app_handle.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(".")))
};
```

Then derive:

```rust
let settings_path = data_root.join("settings.json");
let default_plugin_root = data_root.join("plugins");
let connections_path = data_root.join("connections.json");
let log_path = data_root.join("logs").join("zookeeper-debug.jsonl");
```

Add a Tauri command:

```rust
#[tauri::command]
pub fn get_runtime_info(state: State<'_, AppState>) -> Result<RuntimeInfoDto, String> {
    Ok(RuntimeInfoDto {
        mode: match state.runtime_mode() {
            RuntimeMode::Standard => "standard".to_string(),
            RuntimeMode::Portable => "portable".to_string(),
        },
        data_root: state.data_root().display().to_string(),
    })
}
```

Register it in `src-tauri/src/lib.rs`.

- [ ] **Step 4: Re-run the runtime mode test and verify it passes**

Run: `cd src-tauri; cargo test --test runtime_mode_tests --no-run`

Expected: PASS (compiles)

### Task 2: Add Backend `connections.json` Persistence

**Files:**
- Modify: `src-tauri/src/domain.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/connection_store_tests.rs`

- [ ] **Step 1: Write the failing connection store tests**

Create `src-tauri/tests/connection_store_tests.rs`:

```rust
use std::path::PathBuf;

use zoocute_lib::commands::{AppState, RuntimeMode};
use zoocute_lib::domain::SavedConnectionDto;

#[test]
fn returns_default_connection_when_connections_file_is_missing() {
    let root = PathBuf::from("target/test-connections-default");
    let state = AppState::new_for_tests_with_runtime_mode(
        root.join("logs/zookeeper-debug.jsonl"),
        root.join("settings.json"),
        root.join("plugins"),
        root.join("connections.json"),
        RuntimeMode::Standard,
        root,
    );

    let connections = state.load_saved_connections().expect("should load defaults");

    assert_eq!(connections.len(), 1);
    assert_eq!(connections[0].id, "local");
}

#[test]
fn persists_connections_to_connections_json() {
    let root = PathBuf::from("target/test-connections-save");
    let state = AppState::new_for_tests_with_runtime_mode(
        root.join("logs/zookeeper-debug.jsonl"),
        root.join("settings.json"),
        root.join("plugins"),
        root.join("connections.json"),
        RuntimeMode::Portable,
        root.clone(),
    );

    let payload = vec![SavedConnectionDto {
        id: "prod".into(),
        name: "Production".into(),
        connection_string: "10.0.0.1:2181".into(),
        username: Some("admin".into()),
        password: Some("secret".into()),
        timeout_ms: 5000,
    }];

    state.save_saved_connections(payload.clone()).expect("should save");
    let loaded = state.load_saved_connections().expect("should reload");

    assert_eq!(loaded, payload);
    assert!(root.join("connections.json").exists());
}
```

- [ ] **Step 2: Run the connection store test and verify it fails**

Run: `cd src-tauri; cargo test --test connection_store_tests --no-run`

Expected: FAIL because `SavedConnectionDto` and connection-store helpers do not exist yet.

- [ ] **Step 3: Write the minimal backend connection store implementation**

In `src-tauri/src/domain.rs`, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnectionDto {
    pub id: String,
    pub name: String,
    pub connection_string: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub timeout_ms: u64,
}
```

In `src-tauri/src/commands.rs`, add:

```rust
fn default_saved_connections() -> Vec<SavedConnectionDto> {
    vec![SavedConnectionDto {
        id: "local".to_string(),
        name: "本地开发".to_string(),
        connection_string: "127.0.0.1:2181".to_string(),
        username: None,
        password: None,
        timeout_ms: 5000,
    }]
}

pub fn load_saved_connections(&self) -> Result<Vec<SavedConnectionDto>, String> { ... }
pub fn save_saved_connections(&self, connections: Vec<SavedConnectionDto>) -> Result<Vec<SavedConnectionDto>, String> { ... }
```

Use `self.connections_path()` and `serde_json` to read/write `connections.json`, defaulting to `default_saved_connections()` if the file is missing or unreadable.

Add Tauri commands:

```rust
#[tauri::command]
pub fn get_saved_connections(state: State<'_, AppState>) -> Result<Vec<SavedConnectionDto>, String> { ... }

#[tauri::command]
pub fn set_saved_connections(
    connections: Vec<SavedConnectionDto>,
    state: State<'_, AppState>,
) -> Result<Vec<SavedConnectionDto>, String> { ... }
```

Register them in `src-tauri/src/lib.rs`.

- [ ] **Step 4: Re-run the connection store test and verify it passes**

Run: `cd src-tauri; cargo test --test connection_store_tests --no-run`

Expected: PASS (compiles)

### Task 3: Replace Frontend `localStorage` Connections With Backend Commands

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/commands.ts`
- Modify: `src/hooks/use-persisted-connections.ts`
- Modify: `src/hooks/use-workbench-state.ts`
- Test: `src/persisted-connections.test.ts`

- [ ] **Step 1: Write the failing frontend connection hook tests**

Update `src/persisted-connections.test.ts` to mock command wrappers instead of `localStorage`:

```ts
import { renderHook, waitFor, act } from "@testing-library/react";
import { vi } from "vitest";
import { usePersistedConnections } from "./hooks/use-persisted-connections";

vi.mock("./lib/commands", () => ({
  getSavedConnections: vi.fn(async () => [
    { id: "local", name: "本地开发", connectionString: "127.0.0.1:2181", timeoutMs: 5000 },
  ]),
  setSavedConnections: vi.fn(async (connections) => connections),
}));

it("loads saved connections from the backend", async () => {
  const { result } = renderHook(() => usePersistedConnections());
  await waitFor(() => expect(result.current.savedConnections).toHaveLength(1));
  expect(result.current.savedConnections[0].id).toBe("local");
});

it("persists connection changes through the backend", async () => {
  const { result } = renderHook(() => usePersistedConnections());
  await waitFor(() => expect(result.current.savedConnections).toHaveLength(1));

  await act(async () => {
    result.current.setSavedConnections([
      { id: "prod", name: "Production", connectionString: "10.0.0.1:2181", timeoutMs: 5000 },
    ]);
  });

  expect(setSavedConnectionsMock).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the hook test and verify it fails**

Run: `npm test -- --run src/persisted-connections.test.ts`

Expected: FAIL because the hook still uses `localStorage`.

- [ ] **Step 3: Write the minimal backend-backed hook implementation**

Extend `src/lib/commands.ts`:

```ts
export async function getRuntimeInfo(): Promise<{ mode: "standard" | "portable"; dataRoot: string }> {
  return invoke("get_runtime_info");
}

export async function getSavedConnections(): Promise<SavedConnection[]> {
  return invoke("get_saved_connections");
}

export async function setSavedConnections(connections: SavedConnection[]): Promise<SavedConnection[]> {
  return invoke("set_saved_connections", { connections });
}
```

Update `src/hooks/use-persisted-connections.ts` to:

```ts
const DEFAULT_CONNECTIONS: SavedConnection[] = [];

export function usePersistedConnections() {
  const [savedConnections, setSavedConnectionsState] = useState<SavedConnection[]>(DEFAULT_CONNECTIONS);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);

  useEffect(() => {
    void getSavedConnections().then((connections) => {
      setSavedConnectionsState(connections);
      setSelectedConnectionId((current) => current ?? connections[0]?.id ?? null);
    });
  }, []);

  const setSavedConnections = useEffectEvent(async (nextValue: SetStateAction<SavedConnection[]>) => {
    const resolved =
      typeof nextValue === "function" ? nextValue(savedConnections) : nextValue;
    const persisted = await persistSavedConnections(resolved);
    setSavedConnectionsState(persisted);
    setSelectedConnectionId((current) => current && persisted.some((item) => item.id === current)
      ? current
      : persisted[0]?.id ?? null);
  });

  return { savedConnections, setSavedConnections, selectedConnectionId, setSelectedConnectionId };
}
```

Keep the public hook shape stable so the rest of the app changes minimally.

- [ ] **Step 4: Re-run the hook test and verify it passes**

Run: `npm test -- --run src/persisted-connections.test.ts`

Expected: PASS

### Task 4: Add Portable-Mode UI Behavior To Settings Panel

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/settings-panel.tsx`
- Create: `src/components/settings-panel-portable.test.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Write the failing portable settings UI tests**

Create `src/components/settings-panel-portable.test.tsx`:

```ts
import { render, screen } from "@testing-library/react";
import { SettingsPanel } from "./settings-panel";

it("shows portable mode badge and plugin path as readonly in portable mode", () => {
  render(
    <SettingsPanel
      isOpen={true}
      runtimeMode="portable"
      settings={{ theme: "system", writeMode: "readonly", pluginDirectory: null }}
      effectivePluginDirectory="D:/ZooCutePortable/zoo_data/plugins"
      onClose={() => {}}
      onThemeChange={() => {}}
      onWriteModeChange={() => {}}
      onChoosePluginDirectory={() => {}}
      onResetPluginDirectory={() => {}}
      onOpenPluginDirectory={() => {}}
    />
  );

  expect(screen.getByText(/Portable Mode/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "选择目录" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "恢复默认" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "打开插件目录" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the portable settings UI test and verify it fails**

Run: `npm test -- --run src/components/settings-panel-portable.test.tsx`

Expected: FAIL because `SettingsPanel` does not accept a runtime mode prop yet.

- [ ] **Step 3: Write the minimal portable settings UI implementation**

Update `src/components/settings-panel.tsx` props:

```ts
runtimeMode: "standard" | "portable";
```

Render:

```tsx
{runtimeMode === "portable" && (
  <p className="settings-panel__badge">Portable Mode / 便携版</p>
)}
```

In the plugin section:

```tsx
{runtimeMode === "portable" ? (
  <>
    <p className="settings-section__hint">便携版插件目录固定为程序目录下的 zoo_data/plugins</p>
    <button type="button" className="btn btn-primary" onClick={onOpenPluginDirectory}>
      打开插件目录
    </button>
  </>
) : (
  <>
    <button ...>选择目录</button>
    <button ...>恢复默认</button>
    <button ...>打开插件目录</button>
  </>
)}
```

Update `src/App.tsx` to load runtime info on mount:

```ts
const [runtimeMode, setRuntimeMode] = useState<"standard" | "portable">("standard");
useEffect(() => {
  void getRuntimeInfo().then((info) => setRuntimeMode(info.mode));
}, []);
```

Pass `runtimeMode` through to `SettingsPanel`.

- [ ] **Step 4: Re-run the portable settings UI test and verify it passes**

Run: `npm test -- --run src/components/settings-panel-portable.test.tsx src/App.test.tsx`

Expected: PASS

### Task 5: Portable Plugin Path Policy And Full Verification

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src/lib/commands.ts`
- Modify: `src/App.tsx`
- Test: `src-tauri/tests/runtime_mode_tests.rs`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Write the failing plugin path policy test**

Extend `src-tauri/tests/runtime_mode_tests.rs`:

```rust
#[test]
fn portable_mode_ignores_custom_plugin_directory_setting() {
    let exe_dir = PathBuf::from("D:/portable/ZooCutePortable");
    let data_root = exe_dir.join("zoo_data");
    let state = AppState::new_for_tests_with_runtime_mode(
        data_root.join("logs/zookeeper-debug.jsonl"),
        data_root.join("settings.json"),
        data_root.join("plugins"),
        data_root.join("connections.json"),
        RuntimeMode::Portable,
        data_root.clone(),
    );

    state.set_plugin_directory(Some("D:/somewhere-else/plugins".to_string())).unwrap();

    assert_eq!(state.plugin_root(), exe_dir.join("zoo_data/plugins"));
}
```

- [ ] **Step 2: Run the runtime mode test and verify it fails**

Run: `cd src-tauri; cargo test --test runtime_mode_tests --no-run`

Expected: FAIL because portable mode still respects the mutable settings value.

- [ ] **Step 3: Write the minimal portable plugin policy**

Update `src-tauri/src/commands.rs`:

```rust
pub fn plugin_root(&self) -> PathBuf {
    if self.runtime_mode == RuntimeMode::Portable {
        return self.default_plugin_root.clone();
    }
    ...
}

pub fn set_plugin_directory(&self, plugin_directory: Option<String>) -> Result<AppSettingsDto, String> {
    if self.runtime_mode == RuntimeMode::Portable {
        let mut settings = self.get_settings();
        settings.plugin_directory = None;
        persist_settings_to_path(&self.settings_path, &settings)?;
        *self.settings.lock().map_err(|_| "failed to acquire settings lock".to_string())? = settings.clone();
        return Ok(settings);
    }
    ...
}
```

That keeps portable mode fixed at `exe_dir/zoo_data/plugins` even if the frontend accidentally calls the command.

- [ ] **Step 4: Re-run the runtime mode test and verify it passes**

Run: `cd src-tauri; cargo test --test runtime_mode_tests --no-run`

Expected: PASS

- [ ] **Step 5: Run the focused frontend verification**

Run:

```bash
npm test -- --run src/persisted-connections.test.ts src/components/settings-panel.test.tsx src/components/settings-panel-portable.test.tsx src/App.test.tsx
```

Expected: PASS

- [ ] **Step 6: Run the focused backend verification**

Run:

```bash
cd src-tauri
cargo check
cargo test --no-run
```

Expected: PASS

- [ ] **Step 7: Run the build verification**

Run:

```bash
npm run build
```

Expected: PASS

---

## Self-Review

Spec coverage:
- Windows-only portable mode: covered by Task 1 and Task 5
- `exe_dir/zoo_data` data root: covered by Task 1
- `connections.json` backend storage: covered by Task 2 and Task 3
- portable plugin directory fixed to `exe_dir/zoo_data/plugins`: covered by Task 5
- settings UI shows portable mode and removes plugin-directory editing in portable mode: covered by Task 4
- shared codepath for standard and portable modes: covered by Task 1 through Task 5

Placeholder scan:
- No `TODO` / `TBD`
- Each task includes explicit test and verification commands

Type consistency:
- Frontend runtime mode uses `"standard" | "portable"`
- Backend runtime mode uses `RuntimeMode::{Standard, Portable}`
- Saved connection DTO keeps existing `camelCase` contract from frontend to backend

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-01-windows-portable-mode.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
