# ZooCute Code Review (2026-03-30)

## Findings

### [P1] Failed post-connect initialization leaks a live backend session

- Files:
  - `src/hooks/use-workbench-state.ts`
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/zk_core/live.rs`
- `submitConnection()` first calls `connectServer()`, then separately loads `/` via `listChildren()`.
- `connect_server` already inserts the live adapter into the backend session map before the frontend asks for `/`.
- If the follow-up root load fails, for example with `NoAuth`, the frontend only shows an error and never sends `disconnect_server`.
- User-visible impact: a connection attempt that looks like it failed can still leave an active backend session, background cache bootstrap, and watches behind.

### [P1] “测试连接” can still report success for credentials that fail on first real read

- Files:
  - `src/hooks/use-workbench-state.ts`
  - `src-tauri/src/zk_core/live.rs`
- `testConnection()` only checks whether `connectServer()` succeeds.
- `connect_live()` currently treats a successful session establishment as success and does not validate an ACL-protected read before returning.
- That means a credential set that establishes a session but cannot read `/` can still produce a green “连接测试成功”.
- This is inconsistent with the real connect flow, which immediately reads `/` and can fail with `NoAuth`.

### [P1] Most session commands still hold the global sessions mutex during ZooKeeper I/O

- File:
  - `src-tauri/src/commands.rs`
- `list_children`, `get_node_details`, `save_node`, `create_node`, and `delete_node` all keep `state.sessions.lock()` held while calling into adapter methods that may perform network I/O.
- A slow or unhealthy ZooKeeper cluster can therefore block every other session’s commands behind the same mutex.
- This defeats the multi-session isolation the UI implies and can make one bad cluster freeze unrelated tabs.

## Residual Risks

- Real watch validation exists now, but it only covers the happy-path event cases; reconnect and re-auth behavior still need targeted regression coverage.
- The frontend now shows clearer auth errors, but the saved-vs-unsaved connection form behavior can still mislead users during retry flows.
