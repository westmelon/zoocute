# ZooKeeper Client Migration Notes (2026-03-30)

## Summary

- Replaced Rust dependency `zookeeper = "0.8.0"` with `zookeeper-client = "0.11.1"` in `src-tauri/Cargo.toml`.
- Reworked `src-tauri/src/zk_core/live.rs` to use the async `zookeeper-client::Client` API.
- Migrated child/data watchers from callback-style `Watcher` handlers to `OneshotWatcher.changed().await`.
- Removed the temporary Windows-only guard that previously blocked live ZooKeeper connections.
- Added explicit frontend connection error formatting so auth failures surface as user-friendly guidance instead of a generic failure.
- Added a valid Windows icon configuration and regenerated `src-tauri/icons/icon.png` / `src-tauri/icons/icon.ico` so Tauri Windows builds succeed.

## Implemented Changes

### Rust backend

- `connect_live()` now builds a `zookeeper-client::Client` via `Client::connector()`.
- Digest auth is attached with `with_auth("digest", ...)`.
- Read/write operations now go through `zookeeper-client` equivalents:
  - `list_children`
  - `get_children`
  - `get_data`
  - `set_data`
  - `create`
  - `delete`
- Child/data watch registration now:
  - registers a oneshot watch,
  - spawns an async task to await the event,
  - reuses the existing cache refresh and Tauri event emission paths.

### Frontend

- `src/hooks/use-workbench-state.ts` now formats connection errors into clearer user-facing messages.
- `NoAuth` / `AuthFailed` now map to an explicit authentication hint.
- `Timeout` now maps to a connectivity hint.
- Empty connect strings now surface a dedicated validation-style message.

### Tests

- Added ignored real-ZooKeeper tests in `src-tauri/src/zk_core/live.rs`:
  - `real_zookeeper_smoke_connects_and_lists_root`
  - `real_zookeeper_children_watch_receives_children_changed`
  - `real_zookeeper_data_watch_receives_data_changed`
  - `real_zookeeper_data_watch_receives_node_deleted`
- Added frontend tests for explicit `NoAuth` messaging in `src/connectivity.test.tsx`.

## Validation Performed

### Rust / Tauri

- `cargo build`
- `cargo build --release`
- `cargo test --lib`
- `cargo test real_zookeeper_ --lib -- --ignored --nocapture`

### Frontend

- `npm test`
- `npm run build`

### Manual / runtime

- Verified the Windows app executable starts successfully.
- Verified real ZooKeeper connectivity against `127.0.0.1:2181`.
- Verified real watch callbacks for:
  - child list changes
  - data changes
  - node deletion

## Known Follow-ups

- The connections page still uses saved connection data when the left-side connect button is clicked; unsaved form edits are not applied until saved.
- `testConnection()` still only validates `connect_server` and does not explicitly verify an ACL-protected read.
- One Windows integration-test binary (`zk_core_tests`) still has a separate `STATUS_ENTRYPOINT_NOT_FOUND` startup issue to investigate.
