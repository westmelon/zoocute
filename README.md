# Zoocute

Zoocute is a desktop ZooKeeper client built with Tauri, Rust, React, and TypeScript. It is designed for day-to-day ZooKeeper inspection and maintenance: connecting to clusters, browsing node trees, viewing node metadata, editing text data, checking operation logs, and decoding node content with parser plugins.

For Chinese developer documentation, see [docs/README.zh-CN.md](docs/README.zh-CN.md).  
For end-user documentation, see [USER_GUIDE.md](USER_GUIDE.md) and [docs/USER_GUIDE.zh-CN.md](docs/USER_GUIDE.zh-CN.md).

## Features

- Desktop app powered by Tauri 2
- Connect to ZooKeeper clusters from a local GUI
- Browse the node tree and open node details
- Search nodes after the in-session tree index is built
- View node metadata such as version, timestamps, children count, and data length
- Edit and save node values for editable text-like content
- Compare local draft content with the latest server value
- Create and delete nodes
- Review recent ZooKeeper operation logs
- Run parser plugins to transform raw node bytes into more readable output

## Tech Stack

- Frontend: React 19, TypeScript, Vite
- Desktop shell: Tauri 2
- Backend: Rust
- ZooKeeper client: `zookeeper-client`
- Tests: Vitest for frontend, `cargo test` for Rust

## Prerequisites

Make sure the following are installed before local development:

- Node.js 20+ and npm
- Rust stable toolchain
- Tauri development prerequisites for your OS

Tauri setup instructions:
- macOS: [Tauri prerequisites](https://tauri.app/start/prerequisites/)
- Windows: [Tauri prerequisites](https://tauri.app/start/prerequisites/)
- Linux: [Tauri prerequisites](https://tauri.app/start/prerequisites/)

## Getting Started

Install frontend dependencies:

```bash
npm install
```

Run the web frontend only:

```bash
npm run dev
```

Run the desktop app in development mode:

```bash
npm run tauri:dev
```

## Common Commands

```bash
# Frontend unit tests
npm test

# Frontend build
npm run build

# Rust tests
cargo test --manifest-path src-tauri/Cargo.toml
```

## Project Structure

```text
src/                 React UI, hooks, commands, and tests
src-tauri/           Rust backend, Tauri bootstrap, integration tests
docs/                Chinese docs and review notes
vite.config.ts       Vite and Vitest configuration
package.json         Frontend scripts and dependencies
```

Key areas:

- [src/App.tsx](src/App.tsx): top-level workspace layout
- [src/hooks/use-workbench-state.ts](src/hooks/use-workbench-state.ts): main UI state and ZooKeeper workflow orchestration
- [src/lib/commands.ts](src/lib/commands.ts): Tauri command bridge
- [src-tauri/src/commands.rs](src-tauri/src/commands.rs): backend command handlers
- [src-tauri/src/lib.rs](src-tauri/src/lib.rs): Tauri app bootstrap and command registration

## Development Notes

### Connections

- Connection settings are managed from the UI.
- Current defaults in the codebase use a `5000 ms` timeout for new connections.
- Authentication fields are optional in the form, but actual access depends on the target ZooKeeper cluster.

### Search

- Search becomes useful after the app has loaded enough tree data for the current session.
- The UI starts a background full-tree load so more nodes become searchable over time.

### Logs

- The app persists ZooKeeper operation logs locally.
- The Rust app bootstrap initializes logs under the Tauri app data directory and writes to `logs/zookeeper-debug.jsonl`.

### Parser Plugins

- Parser plugins are discovered from the app data directory under `plugins/`.
- A plugin must expose a valid `plugin.json` manifest to be listed.
- Plugin execution is time-limited in the backend to avoid hanging the UI.

#### How plugin discovery works

- The plugin root is created under the Tauri app data directory.
- Zoocute scans each direct child directory under `plugins/`.
- A directory is treated as a plugin only when it contains `plugin.json`.
- Disabled plugins with `"enabled": false` are skipped.
- If multiple enabled plugins use the same `id`, discovery fails for that scan.
- Invalid manifests are ignored and logged as discovery warnings.

Example structure:

```text
<app-data-dir>/
  plugins/
    dubbo-provider/
      plugin.json
      decoder.py
```

#### Manifest format

The manifest is defined by the Rust backend and currently supports:

```json
{
  "id": "dubbo-provider",
  "name": "Dubbo Provider Decoder",
  "enabled": true,
  "command": "python3",
  "args": ["decoder.py"]
}
```

Field notes:

- `id`: unique plugin identifier used by the frontend and backend
- `name`: display name shown in the editor toolbar
- `enabled`: optional, defaults to `true`
- `command`: executable to launch
- `args`: optional argument array passed to the executable

At minimum, `id`, `name`, and `command` must be non-empty.

#### How plugin execution works

- When a node is opened, the frontend requests the current plugin list.
- The editor toolbar shows a plugin selector only when at least one plugin is available.
- After the user selects a plugin and clicks `Parse`, the frontend calls `run_parser_plugin`.
- The backend loads the raw node bytes and starts the configured command in the plugin directory as the working directory.
- Zoocute writes the raw node bytes to the plugin process through `stdin`.
- The plugin should write its human-readable result to `stdout`.
- If execution succeeds, the frontend stores the output and enables the `PLUGIN` view tab.

This means a plugin can be implemented in any language, as long as it can:

- read raw bytes from standard input
- write parsed text to standard output
- exit within the timeout window

#### Failure and timeout behavior

- Non-zero exit codes are surfaced as plugin errors and include `stderr` when available.
- Hung plugins are killed by the backend.
- The current timeout used by command execution is `5000 ms`.
- Discovery warnings for broken manifests are appended to the ZooKeeper log store.

The existing Rust tests cover:

- successful stdout collection
- non-zero exit propagation
- timeout handling

See [src-tauri/tests/parser_plugin_command_tests.rs](src-tauri/tests/parser_plugin_command_tests.rs).

#### Minimal example plugin

This example reads the first 4 bytes from `stdin` and prints them as hex:

`plugin.json`

```json
{
  "id": "hex-preview",
  "name": "Hex Preview",
  "enabled": true,
  "command": "python3",
  "args": ["decoder.py"]
}
```

`decoder.py`

```python
import sys

data = sys.stdin.buffer.read()
sys.stdout.write(" ".join(f"{b:02X}" for b in data[:4]))
```

#### Plugin development tips

- Prefer commands that are already available in your target environment.
- Keep plugins fast and deterministic because they run inside the editor workflow.
- Treat input as raw bytes, not guaranteed UTF-8 text.
- Write user-facing parsed output to `stdout`.
- Write diagnostics to `stderr` if you want failures to be easier to debug.
- Use a stable `id`; changing it will make the plugin look like a different tool to the app.

## Testing

Frontend tests:

```bash
npm test
```

Rust tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

If you are working on command wiring, search, plugin execution, or session state, it is worth running both suites.

## Documentation

- English developer doc: [README.md](README.md)
- Chinese developer doc: [docs/README.zh-CN.md](docs/README.zh-CN.md)
- English user guide: [USER_GUIDE.md](USER_GUIDE.md)
- Chinese user guide: [docs/USER_GUIDE.zh-CN.md](docs/USER_GUIDE.zh-CN.md)
