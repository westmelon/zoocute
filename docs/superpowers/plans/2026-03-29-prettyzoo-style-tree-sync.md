# PrettyZoo 风格树同步改造计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让节点被外部删除后再重建时，树能够像 PrettyZoo 一样自动恢复可展开状态，而不是依赖用户手动点击节点后才发现子层级。

**Architecture:** 保留当前 Rust 侧按需 watch 和事件总线，不引入全量 subtree cache；前端把树从“点击驱动发现结构”推进到“缓存驱动修正结构”，在父节点子列表变更后自动识别新增节点、后台补探测其 `childrenCount`，并把结果写回树缓存与搜索缓存。对刚出现但子节点尚未建完的节点，引入短时观察窗口和限流二次探测，兼顾体验与性能。

**Tech Stack:** React, TypeScript, Tauri 2, Vitest, Rust `zookeeper` crate

---

### Task 1: 锁定当前树同步边界与状态入口

**Files:**
- Modify: `src/hooks/use-workbench-state.ts`
- Test: `src/use-workbench-watch.test.tsx`

- [ ] **Step 1: 写失败测试，描述“新节点出现后无需手动点击即可恢复可展开状态”**

```tsx
it("marks a newly recreated node as expandable after parent refresh without requiring openNode", async () => {
  let phase = 0;
  listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
    if (path === "/") {
      if (phase === 0) {
        return [{ path: "/services", name: "services", hasChildren: true }];
      }
      return [{ path: "/services", name: "services", hasChildren: true }];
    }
    if (path === "/services") {
      if (phase === 0) {
        phase = 1;
        return [];
      }
      return [{ path: "/services/bbp", name: "bbp", hasChildren: false }];
    }
    return [];
  });

  getNodeDetailsMock.mockResolvedValue({
    path: "/services/bbp",
    value: "v1",
    dataKind: "text",
    displayModeLabel: "文本 · 可编辑",
    editable: true,
    rawPreview: "",
    decodedPreview: "",
    version: 1,
    childrenCount: 2,
    updatedAt: "",
    cVersion: 0,
    aclVersion: 0,
    cZxid: null,
    mZxid: null,
    cTime: 0,
    mTime: 0,
    ephemeral: false,
  });

  const { result } = await connectAndGet();

  await act(async () => {
    await result.current.ensureChildrenLoaded("/services");
  });

  await act(async () => {
    await emitWatchEvent({
      connectionId: "c1",
      eventType: "children_changed",
      path: "/services",
    });
  });

  await waitFor(() => {
    const services = result.current.treeNodes.find((node) => node.path === "/services");
    const bbp = services?.children?.find((node) => node.path === "/services/bbp");
    expect(bbp?.hasChildren).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认当前实现会失败**

Run: `npm test -- src/use-workbench-watch.test.tsx -t "marks a newly recreated node as expandable"`
Expected: FAIL，当前实现需要手动 `openNode("/services/bbp")` 后才会把 `hasChildren` 修正回来。

- [ ] **Step 3: 在状态层收拢”树写入口”和”节点元信息修正入口”**

在 `src/hooks/use-workbench-state.ts` 增加两个聚焦辅助函数：

```ts
function replaceChildren(
  nodes: NodeTreeItem[],
  parentPath: string,
  children: NodeTreeItem[]
): NodeTreeItem[] { /* 只负责替换某父节点 children，不修改 hasChildren */ }

function patchNodeMeta(
  nodes: NodeTreeItem[],
  targetPath: string,
  patch: Partial<Pick<NodeTreeItem, “hasChildren”>>
): NodeTreeItem[] { /* 只负责修正节点元信息 */ }
```

要求：
- `ensureChildrenLoaded` 只通过 `replaceChildren` 写入子节点列表
- 后续自动探测、详情刷新等只通过 `patchNodeMeta` 修正 `hasChildren`
- 不再把”列表替换”和”元信息修正”混在 `updateNodeHasChildren` 这种单一函数里

**注意行为差异：** 现有 `mergeChildren` 在替换子列表时内联写入 `hasChildren: children.length > 0`。改用 `replaceChildren` 后，`hasChildren` 由 `patchNodeMeta` 单独负责。需同步更新调用侧（`ensureChildrenLoaded` 成功分支在 `replaceChildren` 后立即调用 `patchNodeMeta` 补充 `hasChildren`），确保 Task 1 Step 4 回归时现有测试不因行为变化失败。

- [ ] **Step 4: 跑现有 watch 回归，确认纯重构未破坏行为**

Run: `npm test -- src/use-workbench-watch.test.tsx`
Expected: 现有测试通过，新测试仍失败。

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-workbench-state.ts src/use-workbench-watch.test.tsx
git commit -m "refactor: separate tree child replacement from node meta patching"
```

### Task 2: 父节点刷新后自动补探测新增节点

**Files:**
- Modify: `src/hooks/use-workbench-state.ts`
- Test: `src/use-workbench-watch.test.tsx`

- [ ] **Step 1: 写失败测试，描述“父节点 children_changed 后自动探测新增子节点 childrenCount”**

```tsx
it("probes newly discovered children after a parent refresh and marks them expandable", async () => {
  listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
    if (path === "/") {
      return [{ path: "/services", name: "services", hasChildren: true }];
    }
    if (path === "/services") {
      return [{ path: "/services/bbp", name: "bbp", hasChildren: false }];
    }
    return [];
  });

  getNodeDetailsMock.mockResolvedValue({
    path: "/services/bbp",
    value: "v1",
    dataKind: "text",
    displayModeLabel: "文本 · 可编辑",
    editable: true,
    rawPreview: "",
    decodedPreview: "",
    version: 1,
    childrenCount: 3,
    updatedAt: "",
    cVersion: 0,
    aclVersion: 0,
    cZxid: null,
    mZxid: null,
    cTime: 0,
    mTime: 0,
    ephemeral: false,
  });

  const { result } = await connectAndGet();

  await act(async () => {
    await emitWatchEvent({
      connectionId: "c1",
      eventType: "children_changed",
      path: "/services",
    });
  });

  await waitFor(() => {
    expect(getNodeDetailsMock).toHaveBeenCalledWith("c1", "/services/bbp");
    const services = result.current.treeNodes.find((node) => node.path === "/services");
    expect(services?.children?.[0]?.hasChildren).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/use-workbench-watch.test.tsx -t "probes newly discovered children"`
Expected: FAIL，当前 `children_changed` 只会强刷父节点列表，不会补探测新增节点详情。

- [ ] **Step 3: 在 `ensureChildrenLoaded` 返回值中暴露“新增节点集合”**

将 `ensureChildrenLoaded` 改成返回结构化结果，而不是 `Promise<void>`：

```ts
type EnsureChildrenResult = {
  children: NodeTreeItem[];
  addedPaths: string[];
};
```

规则：
- `addedPaths` 只包含“这次刷新后新出现、之前不存在于当前 parent children 列表中的 path”
- 根节点和普通节点逻辑一致
- `NoNode` 的删除分支仍然短路返回，不把删除场景当成新增场景

- [ ] **Step 4: 在 `handleWatchEvent` 的 `children_changed` / `node_created` 分支追加自动探测**

新增辅助函数：

```ts
const PROBE_CONCURRENCY = 5;

async function probeFreshNodes(connectionId: string, paths: string[]): Promise<void> {
  // 最多 PROBE_CONCURRENCY 个并发 getNodeDetails，避免批量重建时请求风暴
  // childrenCount > 0 时 patchNodeMeta(..., { hasChildren: true })
  // NoNode 直接忽略
}
```

要求：
- 只对 `ensureChildrenLoaded(..., { force: true })` 返回的 `addedPaths` 做探测
- 探测成功后同步更新搜索缓存中的元信息
- 不自动展开这些新增节点
- 不覆盖当前右侧详情面板

- [ ] **Step 5: 跑测试确认通过，并回归 watch 基础行为**

Run: `npm test -- src/use-workbench-watch.test.tsx`
Expected: 新测试通过，旧测试仍通过。

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-workbench-state.ts src/use-workbench-watch.test.tsx
git commit -m "feat: auto probe newly discovered nodes after watch refresh"
```

### Task 3: 为“先创建父节点、后创建子节点”的时序加入短时观察窗口

**Files:**
- Modify: `src/hooks/use-workbench-state.ts`
- Test: `src/use-workbench-watch.test.tsx`

- [ ] **Step 1: 写失败测试，描述”首次探测为空，后续短时间内再次事件到来后自动恢复可展开状态”**

测试需要 fake timers 控制观察窗口，避免依赖真实时间导致慢测试或竞态。

```tsx
it(“re-probes freshly added nodes when descendants arrive shortly after the parent node”, async () => {
  vi.useFakeTimers();
  let detailsCalls = 0;
  listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
    if (path === “/”) {
      return [{ path: “/services”, name: “services”, hasChildren: true }];
    }
    if (path === “/services”) {
      return [{ path: “/services/bbp”, name: “bbp”, hasChildren: false }];
    }
    return [];
  });

  getNodeDetailsMock.mockImplementation(async () => {
    detailsCalls += 1;
    return {
      path: “/services/bbp”,
      value: “v1”,
      dataKind: “text”,
      displayModeLabel: “文本 · 可编辑”,
      editable: true,
      rawPreview: “”,
      decodedPreview: “”,
      version: 1,
      childrenCount: detailsCalls === 1 ? 0 : 2,
      updatedAt: “”,
      cVersion: 0,
      aclVersion: 0,
      cZxid: null,
      mZxid: null,
      cTime: 0,
      mTime: 0,
      ephemeral: false,
    };
  });

  const { result } = await connectAndGet();

  // 第一次事件：bbp 刚出现，首次探测 childrenCount=0，进入观察窗口
  await act(async () => {
    await emitWatchEvent({
      connectionId: “c1”,
      eventType: “children_changed”,
      path: “/services”,
    });
  });

  // 推进时间至窗口内（< RECENT_LEAF_PROBE_WINDOW_MS），第二次事件触发二次探测
  await act(async () => {
    vi.advanceTimersByTime(500);
    await emitWatchEvent({
      connectionId: “c1”,
      eventType: “children_changed”,
      path: “/services”,
    });
  });

  await waitFor(() => {
    const services = result.current.treeNodes.find((node) => node.path === “/services”);
    expect(services?.children?.[0]?.hasChildren).toBe(true);
  });

  vi.useRealTimers();
});
```

补充反向验证：窗口过期后不再二次探测。

```tsx
it(“does not re-probe after the observation window expires”, async () => {
  vi.useFakeTimers();
  let detailsCalls = 0;
  listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
    if (path === “/”) return [{ path: “/services”, name: “services”, hasChildren: true }];
    if (path === “/services”) return [{ path: “/services/bbp”, name: “bbp”, hasChildren: false }];
    return [];
  });

  getNodeDetailsMock.mockImplementation(async () => {
    detailsCalls += 1;
    return {
      path: “/services/bbp”, value: “v1”, dataKind: “text”,
      displayModeLabel: “文本 · 可编辑”, editable: true,
      rawPreview: “”, decodedPreview: “”, version: 1,
      childrenCount: detailsCalls === 1 ? 0 : 2,
      updatedAt: “”, cVersion: 0, aclVersion: 0,
      cZxid: null, mZxid: null, cTime: 0, mTime: 0, ephemeral: false,
    };
  });

  const { result } = await connectAndGet();

  await act(async () => {
    await emitWatchEvent({ connectionId: “c1”, eventType: “children_changed”, path: “/services” });
  });

  // 推进时间超出窗口
  await act(async () => {
    vi.advanceTimersByTime(3000);
    await emitWatchEvent({ connectionId: “c1”, eventType: “children_changed”, path: “/services” });
  });

  await waitFor(() => {
    const services = result.current.treeNodes.find((node) => node.path === “/services”);
    // 窗口已过期，不应二次探测，bbp 仍是叶子
    expect(services?.children?.[0]?.hasChildren).toBe(false);
  });

  expect(getNodeDetailsMock).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/use-workbench-watch.test.tsx -t "re-probes freshly added nodes"`
Expected: FAIL，当前实现首次探测 `childrenCount == 0` 后不会再主动补探测。

- [ ] **Step 3: 在前端引入短时观察窗口和限流状态**

在 `src/hooks/use-workbench-state.ts` 增加连接级 ref：

```ts
const pendingProbeRefs = useRef<Map<string, Set<string>>>(new Map());
const recentLeafProbeRefs = useRef<Map<string, Map<string, number>>>(new Map());
```

规则：
- `pendingProbeRefs` 防止同一路径并发探测（独立于 `pendingChildRefreshRefs`，后者针对 `listChildren`，前者针对 `getNodeDetails`）
- `recentLeafProbeRefs` 记录”刚探测过但 `childrenCount == 0` 的新增节点”及其探测时间戳
- 观察窗口时长写成可导出常量 `RECENT_LEAF_PROBE_WINDOW_MS = 1500`，便于测试通过 fake timers 控制
- 仅对”新增节点”记录观察窗口，不对普通老节点做轮询
- 两个 ref 均须在 `disconnectSession` 中随 `pendingChildRefreshRefs` 一并清理，避免旧会话数据干扰重连

- [ ] **Step 4: 在相关事件上触发二次探测**

处理策略：
- 父节点再次收到 `children_changed` 时，如果该父节点下存在仍在观察窗口内的子节点，重新探测这些路径
- 节点自身收到 `node_created` 或 `children_changed` 且路径命中观察窗口时，也允许触发探测
- 第二次及后续探测仍然只要 `childrenCount > 0` 就立刻修正 `hasChildren`
- 超出观察窗口后不再自动探测，避免变成隐性轮询

- [ ] **Step 5: 跑测试确认通过，并检查不会引入风暴**

Run: `npm test -- src/use-workbench-watch.test.tsx`
Expected: 新测试通过，已有 `coalesces repeated children_changed events...` 仍通过。

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-workbench-state.ts src/use-workbench-watch.test.tsx
git commit -m "feat: re-probe freshly added leaf nodes during rebuild windows"
```

### Task 4: 让搜索缓存跟随节点元信息修正

**Files:**
- Modify: `src/hooks/use-node-search.ts`
- Modify: `src/hooks/use-workbench-state.ts`
- Test: `src/use-workbench-watch.test.tsx`

- [ ] **Step 1: 写失败测试，描述”节点 `hasChildren` 被自动修正后，缓存与树保持一致”**

```tsx
it(“keeps search cache metadata in sync when a recreated node becomes expandable”, async () => {
  listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
    if (path === “/”) return [{ path: “/services”, name: “services”, hasChildren: true }];
    if (path === “/services”) return [{ path: “/services/bbp”, name: “bbp”, hasChildren: false }];
    return [];
  });

  getNodeDetailsMock.mockResolvedValue({
    path: “/services/bbp”,
    value: “v1”,
    dataKind: “text”,
    displayModeLabel: “文本 · 可编辑”,
    editable: true,
    rawPreview: “”,
    decodedPreview: “”,
    version: 1,
    childrenCount: 3,
    updatedAt: “”,
    cVersion: 0,
    aclVersion: 0,
    cZxid: null,
    mZxid: null,
    cTime: 0,
    mTime: 0,
    ephemeral: false,
  });

  const { result } = await connectAndGet();

  // 触发自动探测，使 bbp.hasChildren 被修正为 true
  await act(async () => {
    await emitWatchEvent({ connectionId: “c1”, eventType: “children_changed”, path: “/services” });
  });

  await waitFor(() => {
    const services = result.current.treeNodes.find((n) => n.path === “/services”);
    expect(services?.children?.[0]?.hasChildren).toBe(true);
  });

  // 验证搜索缓存已同步：搜索 bbp 后 locate 不应因缓存旧值而误判其为叶子
  act(() => {
    result.current.setSearchQuery(“bbp”);
  });

  await waitFor(() => {
    const bbpResult = result.current.searchResults.find((r) => r.path === “/services/bbp”);
    expect(bbpResult).toBeDefined();
    // SearchResult 中 hasChildren 应反映修正后状态
    expect(bbpResult?.hasChildren).toBe(true);
  });
});
```

此测试会失败，因为当前 `probeFreshNodes` 只调 `patchNodeMeta` 修树，尚未同步调 `nodeSearch.patchNodeMeta`。

- [ ] **Step 2: 跑测试确认失败或至少无法表达现有一致性**

Run: `npm test -- src/use-workbench-watch.test.tsx -t "keeps search cache metadata in sync"`
Expected: FAIL，或暴露当前 `useNodeSearch` 只有“整批 children 替换”入口、没有元信息修正入口。

- [ ] **Step 3: 给 `useNodeSearch` 增加最小元信息修正接口**

在 `src/hooks/use-node-search.ts` 增加一个轻量方法：

```ts
patchNodeMeta(sessionId: string, path: string, patch: { hasChildren?: boolean }): void
```

要求：
- 只修正单节点元信息
- 不改 parent-child 结构
- 连接断开时仍由现有清理逻辑统一移除整会话缓存

- [ ] **Step 4: 在自动探测成功后同时写树缓存与搜索缓存**

在 `probeFreshNodes` 成功分支中执行：

```ts
nodeSearch.patchNodeMeta(connectionId, path, { hasChildren: true });
```

保证树和搜索的缓存模型一致。

- [ ] **Step 5: 跑测试确认缓存一致性闭环**

Run: `npm test -- src/use-workbench-watch.test.tsx`
Expected: 新测试通过，既有搜索/定位相关测试不回退。

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-node-search.ts src/hooks/use-workbench-state.ts src/use-workbench-watch.test.tsx
git commit -m "feat: sync search cache metadata with watch-driven tree updates"
```

### Task 5: 全量回归与手动验收

**Files:**
- Test: `src/use-workbench-watch.test.tsx`
- Test: `src/connectivity.test.tsx`
- Test: `src/use-workbench-state.test.tsx`
- Test: `src/tauri-config.test.ts`
- Verify: `src-tauri/src/zk_core/live.rs`

- [ ] **Step 1: 跑前端核心回归**

Run: `npm test -- src/use-workbench-watch.test.tsx src/connectivity.test.tsx src/use-workbench-state.test.tsx src/tauri-config.test.ts`
Expected: PASS

- [ ] **Step 2: 跑类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 跑 Rust 回归**

Run: `cargo test`
Expected: PASS

- [ ] **Step 4: 手动验收“删除后重建”主路径**

操作：
1. 启动应用并连接测试 ZK
2. 展开 `/ssdev/services`
3. 在外部删除 `/ssdev/services/bbp`
4. 在外部重新创建 `/ssdev/services/bbp`
5. 再陆续创建 `/ssdev/services/bbp/*`

预期：
- `bbp` 节点重新出现后，无需手动点开详情即可恢复为可展开状态
- 点击展开 `bbp` 时能直接看到新建子节点
- 不出现 `NoNode` 错误提示
- 批量重建时 UI 不明显卡死

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-node-search.ts src/hooks/use-workbench-state.ts src/use-workbench-watch.test.tsx
git commit -m "feat: align watch-driven tree sync more closely with PrettyZoo"
```

## Important Interface Changes

- `ensureChildrenLoaded(connectionId, path, options?)` 内部返回 `Promise<EnsureChildrenResult>`，但**对外暴露的公共包装器签名保持 `Promise<void>`**，`EnsureChildrenResult` 仅在 `handleWatchEvent` 内部消费，不透传给调用方
- `useNodeSearch` 新增 `patchNodeMeta(sessionId, path, patch)`，用于单节点元信息修正
- 前端新增连接级 probe 状态：
  - `pendingProbeRefs`（防止同一路径并发 `getNodeDetails`，独立于现有的 `pendingChildRefreshRefs`）
  - `recentLeafProbeRefs`（记录进入观察窗口的新增叶子节点及探测时间戳）
- 观察窗口时长导出为常量 `RECENT_LEAF_PROBE_WINDOW_MS = 1500`，测试通过 `vi.useFakeTimers()` 控制

## Defaults And Assumptions

- 本期不引入 Rust 全量 subtree cache，不复制 PrettyZoo 的 `TreeCache(“/”)` 实现
- 自动恢复的是”可展开状态”，不是自动展开全部新节点，避免树抖动
- 观察窗口 1500ms 是优化，不是保证——超出窗口未完成修正的节点，用户点击时 `openNode` 的 `getNodeDetails` 调用会兜底修正 `hasChildren`，这条路径始终有效
- `NoNode` 视为合法竞态，不向用户报错
- 所有自动补探测都必须限流，不能回退到此前的事件风暴卡顿问题
- `addedPaths` diff 必须用 `await listChildren(...)` **调用前**同步读取的旧 children 集合计算，不在 `updateSession` 回调里读：`prevPaths = new Set(currentChildren.map(n => n.path))`，然后 `addedPaths = fresh.filter(n => !prevPaths.has(n.path))`
- `probeFreshNodes` 内部只通过 `updateSession` 的函数式更新写状态，不通过外层闭包读 `sessions`
