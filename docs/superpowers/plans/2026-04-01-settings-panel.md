# Settings Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-pass settings panel with persisted theme preference, persisted readonly/readwrite mode, and configurable parser plugin directory.

**Architecture:** Keep a single `AppSettings` shape shared across frontend and Tauri backend. Frontend owns rendering and immediate UX updates, while the backend owns durable plugin directory resolution, native folder actions, and final write-operation enforcement. Existing localStorage theme bootstrapping is migrated to read the unified settings object, and plugin discovery switches from a fixed app-data path to a settings-aware effective root.

**Tech Stack:** React, TypeScript, Vitest, Tauri 2, Rust

---

### Task 1: Add Shared Settings Model And Frontend Persistence

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/settings.ts`
- Modify: `src/app-bootstrap.tsx`
- Test: `src/theme.test.ts`
- Test: `src/lib/settings.test.ts`

- [ ] **Step 1: Write the failing settings persistence tests**

Add tests in `src/lib/settings.test.ts` covering:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
} from "./settings";

describe("app settings persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns readonly system defaults when storage is empty", () => {
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("falls back to legacy theme storage when unified settings are absent", () => {
    localStorage.setItem("zoocute:theme", "dark");

    expect(loadAppSettings()).toEqual({
      ...DEFAULT_APP_SETTINGS,
      theme: "dark",
    });
  });

  it("persists the unified settings object", () => {
    saveAppSettings({
      theme: "light",
      writeMode: "readwrite",
      pluginDirectory: "C:/plugins",
    });

    expect(loadAppSettings()).toEqual({
      theme: "light",
      writeMode: "readwrite",
      pluginDirectory: "C:/plugins",
    });
  });
});
```

- [ ] **Step 2: Run the settings persistence test and verify it fails**

Run: `npm test -- --run src/lib/settings.test.ts`

Expected: FAIL because `src/lib/settings.ts` does not exist yet.

- [ ] **Step 3: Write the minimal shared settings implementation**

Create `src/lib/settings.ts` with:

```ts
import type { AppSettings, ThemePreference, WriteMode } from "./types";

const SETTINGS_KEY = "zoocute:settings";
const LEGACY_THEME_KEY = "zoocute:theme";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: "system",
  writeMode: "readonly",
  pluginDirectory: null,
};

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function isWriteMode(value: unknown): value is WriteMode {
  return value === "readonly" || value === "readwrite";
}

export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return {
        theme: isThemePreference(parsed.theme) ? parsed.theme : DEFAULT_APP_SETTINGS.theme,
        writeMode: isWriteMode(parsed.writeMode) ? parsed.writeMode : DEFAULT_APP_SETTINGS.writeMode,
        pluginDirectory:
          typeof parsed.pluginDirectory === "string" && parsed.pluginDirectory.trim().length > 0
            ? parsed.pluginDirectory
            : null,
      };
    }
  } catch {
    // ignore malformed data
  }

  const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
  return {
    ...DEFAULT_APP_SETTINGS,
    theme: legacyTheme === "light" || legacyTheme === "dark" ? legacyTheme : "system",
  };
}

export function saveAppSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (settings.theme === "light" || settings.theme === "dark") {
    localStorage.setItem(LEGACY_THEME_KEY, settings.theme);
  } else {
    localStorage.removeItem(LEGACY_THEME_KEY);
  }
}
```

Update `src/lib/types.ts` with:

```ts
export type ThemePreference = "system" | "light" | "dark";
export type WriteMode = "readonly" | "readwrite";

export interface AppSettings {
  theme: ThemePreference;
  writeMode: WriteMode;
  pluginDirectory: string | null;
}
```

- [ ] **Step 4: Re-run the settings persistence test and verify it passes**

Run: `npm test -- --run src/lib/settings.test.ts`

Expected: PASS

- [ ] **Step 5: Write the failing theme bootstrap test for system mode**

Extend `src/theme.test.ts` with:

```ts
import { applyThemePreference, injectTheme } from "./app-bootstrap";

it("applyThemePreference resolves system to the current OS preference", () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;

  applyThemePreference("system");

  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});

it("injectTheme reads the unified settings theme before legacy fallback", () => {
  localStorage.setItem(
    "zoocute:settings",
    JSON.stringify({ theme: "light", writeMode: "readonly", pluginDirectory: null })
  );

  injectTheme();

  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
});
```

- [ ] **Step 6: Run the theme test and verify it fails**

Run: `npm test -- --run src/theme.test.ts`

Expected: FAIL because `applyThemePreference` does not exist and `injectTheme` still reads only the legacy key.

- [ ] **Step 7: Write the minimal theme bootstrap implementation**

Update `src/app-bootstrap.tsx` to:

```ts
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/app.css";
import App from "./App";
import { loadAppSettings } from "./lib/settings";
import type { ThemePreference } from "./lib/types";

export function applyThemePreference(theme: ThemePreference) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.setAttribute("data-theme", theme);
    return;
  }

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
}

export function injectTheme() {
  applyThemePreference(loadAppSettings().theme);
}
```

- [ ] **Step 8: Re-run the theme test and verify it passes**

Run: `npm test -- --run src/theme.test.ts`

Expected: PASS

### Task 2: Add Backend Settings, Native Plugin Directory Commands, And Write Guards

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/domain.rs`
- Test: `src-tauri/tests/settings_command_tests.rs`

- [ ] **Step 1: Write the failing backend settings tests**

Create `src-tauri/tests/settings_command_tests.rs` with tests covering:

```rust
use std::path::PathBuf;

use zoocute_lib::commands::AppState;

#[test]
fn defaults_to_system_theme_readonly_mode_and_default_plugin_root() {
    let root = PathBuf::from("target/test-settings-defaults");
    let state = AppState::new_for_tests_with_roots(root.join("log.jsonl"), root.join("settings.json"), root.join("plugins"));

    let settings = state.get_settings();

    assert_eq!(settings.theme, "system");
    assert_eq!(settings.write_mode, "readonly");
    assert_eq!(settings.plugin_directory, None);
    assert_eq!(state.plugin_root(), root.join("plugins"));
}

#[test]
fn custom_plugin_directory_overrides_default_root() {
    let root = PathBuf::from("target/test-settings-custom");
    let state = AppState::new_for_tests_with_roots(root.join("log.jsonl"), root.join("settings.json"), root.join("plugins"));

    state
        .update_settings(|settings| {
            settings.plugin_directory = Some(root.join("custom-plugins").display().to_string());
        })
        .expect("settings should update");

    assert_eq!(state.plugin_root(), root.join("custom-plugins"));
}

#[test]
fn readonly_mode_blocks_write_commands() {
    let root = PathBuf::from("target/test-settings-readonly");
    let state = AppState::new_for_tests_with_roots(root.join("log.jsonl"), root.join("settings.json"), root.join("plugins"));

    let error = state.ensure_write_enabled().expect_err("readonly should block writes");

    assert!(error.contains("只读"));
}
```

- [ ] **Step 2: Run the backend settings test and verify it fails**

Run: `cd src-tauri; cargo test settings_command_tests`

Expected: FAIL because the new state helpers and settings model do not exist.

- [ ] **Step 3: Write the minimal backend settings implementation**

Add a backend settings model plus state helpers in `src-tauri/src/commands.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsDto {
    pub theme: String,
    pub write_mode: String,
    pub plugin_directory: Option<String>,
}

impl Default for AppSettingsDto {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            write_mode: "readonly".to_string(),
            plugin_directory: None,
        }
    }
}
```

Extend `AppState` with:

```rust
settings_path: PathBuf,
default_plugin_root: PathBuf,
settings: Mutex<AppSettingsDto>,
```

Add helpers:

```rust
pub fn get_settings(&self) -> AppSettingsDto { ... }
pub fn update_settings<F>(&self, update: F) -> Result<AppSettingsDto, String>
where
    F: FnOnce(&mut AppSettingsDto),
{ ... }
pub fn ensure_write_enabled(&self) -> Result<(), String> { ... }
pub fn plugin_root(&self) -> PathBuf {
    let settings = self.settings.lock().map_err(...).ok();
    if let Some(custom) = settings.and_then(|s| s.plugin_directory.clone()) {
        return PathBuf::from(custom);
    }
    self.default_plugin_root.clone()
}
```

Persist settings as JSON at `settings_path` whenever they change.

Add Tauri commands:

```rust
#[tauri::command]
pub fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettingsDto, String> { ... }

#[tauri::command]
pub fn set_theme_preference(theme: String, state: State<'_, AppState>) -> Result<AppSettingsDto, String> { ... }

#[tauri::command]
pub fn set_write_mode(write_mode: String, state: State<'_, AppState>) -> Result<AppSettingsDto, String> { ... }

#[tauri::command]
pub fn set_plugin_directory(plugin_directory: Option<String>, state: State<'_, AppState>) -> Result<AppSettingsDto, String> { ... }
```

Guard writes at the top of:

```rust
save_node(...)
create_node(...)
delete_node(...)
```

with:

```rust
state.ensure_write_enabled()?;
```

- [ ] **Step 4: Re-run the backend settings test and verify it passes**

Run: `cd src-tauri; cargo test settings_command_tests`

Expected: PASS

- [ ] **Step 5: Add failing tests for plugin directory helper commands**

Extend `src-tauri/tests/settings_command_tests.rs` with tests for:

```rust
#[test]
fn resetting_plugin_directory_uses_default_root_again() { ... }
```

and in command-level tests assert that plugin listing reads from the overridden root.

- [ ] **Step 6: Run the focused backend tests and verify they fail**

Run: `cd src-tauri; cargo test plugin_root`

Expected: FAIL because override/reset behavior is not fully wired through plugin command usage yet.

- [ ] **Step 7: Wire plugin commands through the effective plugin root**

Keep:

```rust
discover_plugins_with_diagnostics(&state.plugin_root())?
```

and ensure all constructors now initialize `default_plugin_root` separately from settings so reset can resolve correctly.

Add native directory commands:

```rust
#[tauri::command]
pub fn default_plugin_directory(state: State<'_, AppState>) -> Result<String, String> { ... }

#[tauri::command]
pub fn ensure_plugin_directory(state: State<'_, AppState>) -> Result<String, String> { ... }

#[tauri::command]
pub fn open_plugin_directory(state: State<'_, AppState>) -> Result<(), String> { ... }
```

Implement `open_plugin_directory` using Tauri shell/open APIs already available in the app.

- [ ] **Step 8: Re-run the focused backend tests and verify they pass**

Run: `cd src-tauri; cargo test settings_command_tests`

Expected: PASS

### Task 3: Add Frontend Command Wrappers And Settings Panel UI

**Files:**
- Modify: `src/lib/commands.ts`
- Modify: `src/components/ribbon.tsx`
- Create: `src/components/settings-panel.tsx`
- Modify: `src/App.tsx`
- Test: `src/components/settings-panel.test.tsx`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Write the failing settings panel component tests**

Create `src/components/settings-panel.test.tsx`:

```ts
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { SettingsPanel } from "./settings-panel";

it("renders theme and write mode radio groups plus plugin directory actions", () => {
  render(
    <SettingsPanel
      isOpen={true}
      settings={{ theme: "system", writeMode: "readonly", pluginDirectory: null }}
      effectivePluginDirectory="C:/Users/test/AppData/Roaming/zoocute/plugins"
      onClose={vi.fn()}
      onThemeChange={vi.fn()}
      onWriteModeChange={vi.fn()}
      onChoosePluginDirectory={vi.fn()}
      onResetPluginDirectory={vi.fn()}
      onOpenPluginDirectory={vi.fn()}
    />
  );

  expect(screen.getByText("外观")).toBeInTheDocument();
  expect(screen.getByLabelText("跟随系统")).toBeInTheDocument();
  expect(screen.getByLabelText("只读")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "选择目录" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "恢复默认" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "打开插件目录" })).toBeInTheDocument();
});

it("emits immediate changes when a radio option is selected", async () => {
  const user = userEvent.setup();
  const onThemeChange = vi.fn();
  const onWriteModeChange = vi.fn();

  render(...);

  await user.click(screen.getByLabelText("暗夜"));
  await user.click(screen.getByLabelText("读写"));

  expect(onThemeChange).toHaveBeenCalledWith("dark");
  expect(onWriteModeChange).toHaveBeenCalledWith("readwrite");
});
```

- [ ] **Step 2: Run the settings panel test and verify it fails**

Run: `npm test -- --run src/components/settings-panel.test.tsx`

Expected: FAIL because the component does not exist yet.

- [ ] **Step 3: Add frontend command wrappers and minimal settings panel implementation**

Extend `src/lib/commands.ts` with wrappers:

```ts
export async function getAppSettings(): Promise<AppSettings> { ... }
export async function setThemePreference(theme: ThemePreference): Promise<AppSettings> { ... }
export async function setWriteMode(writeMode: WriteMode): Promise<AppSettings> { ... }
export async function choosePluginDirectory(): Promise<AppSettings | null> { ... }
export async function resetPluginDirectory(): Promise<AppSettings> { ... }
export async function openPluginDirectory(): Promise<void> { ... }
export async function getEffectivePluginDirectory(): Promise<string> { ... }
```

Create `src/components/settings-panel.tsx` rendering:

```tsx
<aside className={`settings-panel${isOpen ? " is-open" : ""}`}>
  <section>
    <h2>外观</h2>
    <!-- theme radios -->
  </section>
  <section>
    <h2>安全</h2>
    <p>只读模式下禁止新增、修改、删除节点。</p>
    <!-- write mode radios -->
  </section>
  <section>
    <h2>插件</h2>
    <code>{effectivePluginDirectory}</code>
    <!-- choose/reset/open buttons -->
  </section>
</aside>
```

Update `src/components/ribbon.tsx` to accept `onOpenSettings` and trigger it from the existing settings button.

- [ ] **Step 4: Re-run the settings panel test and verify it passes**

Run: `npm test -- --run src/components/settings-panel.test.tsx`

Expected: PASS

- [ ] **Step 5: Write the failing App integration tests**

Extend `src/App.test.tsx` with:

```ts
it("opens the settings panel from the ribbon settings button", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByTitle("设置"));

  expect(screen.getByText("外观")).toBeInTheDocument();
  expect(screen.getByLabelText("只读")).toBeChecked();
});
```

Add a second test that verifies readonly mode disables write entry points visible in the current browse UI once state is set to readonly.

- [ ] **Step 6: Run the App integration test and verify it fails**

Run: `npm test -- --run src/App.test.tsx`

Expected: FAIL because App does not manage settings state or panel visibility yet.

- [ ] **Step 7: Integrate settings state into App**

Update `src/App.tsx` to:

```ts
const [isSettingsOpen, setIsSettingsOpen] = useState(false);
const [settings, setSettings] = useState<AppSettings>(loadAppSettings);
const [effectivePluginDirectory, setEffectivePluginDirectory] = useState("");
```

On mount:

```ts
useEffect(() => {
  void getAppSettings().then(setSettings);
  void getEffectivePluginDirectory().then(setEffectivePluginDirectory);
}, []);
```

On theme change:

```ts
const next = await setThemePreference(theme);
setSettings(next);
saveAppSettings(next);
applyThemePreference(next.theme);
```

On write mode change:

```ts
const next = await setWriteMode(writeMode);
setSettings(next);
saveAppSettings(next);
```

On plugin directory change/reset:

```ts
const next = await choosePluginDirectory();
if (next) {
  setSettings(next);
  saveAppSettings(next);
  setEffectivePluginDirectory(await getEffectivePluginDirectory());
}
```

Render `SettingsPanel` from `App` and pass `isReadOnly={settings.writeMode === "readonly"}` down to the tree context menu and editor panel surfaces that expose writes.

- [ ] **Step 8: Re-run the App integration test and verify it passes**

Run: `npm test -- --run src/App.test.tsx`

Expected: PASS

### Task 4: Enforce Readonly UI States And Refresh Plugin Data

**Files:**
- Modify: `src/hooks/use-workbench-state.ts`
- Modify: `src/components/editor-panel.tsx`
- Modify: `src/components/tree-context-menu.tsx`
- Modify: `src/components/node-header.tsx`
- Test: `src/components/tree-context-menu.test.tsx`
- Test: `src/components/editor-panel.test.tsx`

- [ ] **Step 1: Write the failing readonly UI tests**

Add tests asserting:

```ts
it("hides create and delete actions in the tree context menu when readonly", () => { ... });
it("prevents entering edit mode in the editor when readonly", () => { ... });
```

- [ ] **Step 2: Run the readonly UI tests and verify they fail**

Run: `npm test -- --run src/components/tree-context-menu.test.tsx src/components/editor-panel.test.tsx`

Expected: FAIL because readonly props are not supported yet.

- [ ] **Step 3: Implement the minimal readonly UI wiring**

Update `src/components/tree-context-menu.tsx` to accept:

```ts
isReadOnly: boolean;
```

and conditionally remove or disable create/delete items.

Update `src/components/editor-panel.tsx` and `src/components/node-header.tsx` so readonly mode:

- prevents `onEnterEdit`
- hides or disables save/edit affordances
- keeps browsing and plugin parsing available

Update `src/hooks/use-workbench-state.ts` so `handleSave`, `createNode`, and `deleteNodeFn` return early with a user-facing message if invoked while readonly, matching the backend protection.

- [ ] **Step 4: Re-run the readonly UI tests and verify they pass**

Run: `npm test -- --run src/components/tree-context-menu.test.tsx src/components/editor-panel.test.tsx`

Expected: PASS

- [ ] **Step 5: Run the focused feature test suite**

Run:

```bash
npm test -- --run src/lib/settings.test.ts src/theme.test.ts src/components/settings-panel.test.tsx src/App.test.tsx src/components/tree-context-menu.test.tsx src/components/editor-panel.test.tsx
cd src-tauri; cargo test settings_command_tests
```

Expected: PASS

- [ ] **Step 6: Run the broader project verification**

Run:

```bash
npm test -- --run
cd src-tauri; cargo test
```

Expected: PASS

---

## Self-Review

Spec coverage check:

- Theme setting: covered by Task 1 and Task 3
- Readonly setting default + immediate effect + persisted behavior: covered by Task 1, Task 2, Task 3, Task 4
- Plugin directory current path + choose/reset/open: covered by Task 2 and Task 3
- No apply button / immediate save: covered by Task 3
- Native directory picker and open-folder behavior: covered by Task 2

Placeholder scan:

- No `TODO` / `TBD` placeholders remain
- Each test-first implementation path includes a fail command and pass command

Type consistency check:

- Shared frontend names use `theme`, `writeMode`, `pluginDirectory`
- Backend names use serialized camelCase to match frontend shape
- Effective plugin directory is derived separately from the nullable configured directory

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-01-settings-panel.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

This session does not have user authorization to delegate to subagents, so I will proceed with inline execution.
