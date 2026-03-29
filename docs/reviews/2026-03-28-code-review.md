# ZooCute Code Review (2026-03-28)

## Findings

### [P1] Root-level create/delete never refreshes the tree

- Files:
  - `src/hooks/use-workbench-state.ts:97`
  - `src/hooks/use-workbench-state.ts:223`
  - `src/hooks/use-workbench-state.ts:234`
- `createNode()` and `deleteNodeFn()` both refresh the parent path after a write. For root children that parent path is `/`, but `ensureChildrenLoaded()` only refreshes paths that already exist as nodes inside `session.treeNodes`.
- The root itself is not stored as a node. After initial connect, the tree contains entries like `/services`, not `/`.
- Result: creating `/foo` under `/` or deleting `/foo` from `/` succeeds on the backend but the left tree never updates until the user reconnects.
- Existing tests only cover initial root loading and non-root lazy loading, so this regression is currently untested.

### [P1] The connections page only marks the active tab as connected

- Files:
  - `src/App.tsx:80`
  - `src/components/connection-pane.tsx:30`
  - `src/hooks/use-workbench-state.ts:63`
- `ConnectionPane` receives a single `connectedId`, and `App` passes `activeTabId`.
- In a multi-session scenario, every connected session except the currently active tab is rendered as disconnected. On the connections page that exposes a `连接` action for an already connected server.
- Clicking that action calls `submitConnection()` again for the same `connectionId`, which recreates the session state in `addSession()` and opens another backend connection without first disconnecting the existing one.
- User-visible impact: the UI lies about connection status, and reconnecting an already-open tab can discard that tab's expanded paths, selected node, and unsaved drafts.

### [P1] Backend commands serialize all session I/O behind one mutex

- File:
  - `src-tauri/src/commands.rs:58`
- `list_children`, `get_node_details`, `save_node`, `create_node`, and `delete_node` all hold `state.sessions.lock()` while executing ZooKeeper operations on the adapter.
- Those adapter methods perform network I/O, so one slow request on session A blocks every command for session B, including disconnects and reads.
- That effectively defeats the new multi-session design under load: two open clusters are not independent, and one unhealthy cluster can freeze operations for the others.
- The tests do not exercise cross-session concurrency, so this class of regression would not be caught by the current suite.

## Open Questions

- Should reconnecting an already connected saved connection be rejected, switched to the existing tab, or treated as an explicit refresh?
- Do we want root `/` represented as a synthetic tree node in state, or handled as a special case in refresh logic?

## Test Gaps

- No test covers create/delete under root `/`.
- No test covers the connections page with two simultaneous active sessions.
- No test covers backend behavior when one session is slow and another is active at the same time.
