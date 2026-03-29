# ZooCute 节点搜索重构方案（对齐 PrettyZoo）

**日期：** 2026-03-28
**状态：** 草案

---

## 目标

将 ZooCute 当前“直接过滤当前树节点”的搜索实现，重构为更接近 PrettyZoo 的机制：

- 使用独立的节点缓存索引，而不是直接筛选树组件
- 搜索结果以单独结果列表展示，而不是破坏原树结构
- 搜索命中后再回定位树节点
- 搜索范围覆盖当前会话内已缓存的节点，而不是仅限当前可见节点

本方案刻意向 PrettyZoo 靠拢，不追求“最省事实现”，而追求“交互模型和内部结构与 PrettyZoo 尽量一致”。

---

## 现状问题

当前实现位于 [browser-pane.tsx](/Users/neolin/Playground/zoocute/src/components/browser-pane.tsx)：

- 搜索直接对 `treeNodes` 顶层数组做 `filter`
- 只检查第一层节点
- 不递归子树
- 不保留命中结果的祖先链
- 不提供单独的搜索结果列表
- 不支持从搜索结果回定位树

因此当前搜索不是“节点搜索”，而只是“顶层列表过滤”。

---

## PrettyZoo 的核心做法

根据 PrettyZoo 公开源码，可归纳为以下结构：

1. 维护树节点缓存，而不是搜索 TreeView 当前可见项
2. 缓存底层有独立搜索结构 `PathTrie`
3. 搜索输入变化后，调用 Facade 层统一执行搜索
4. 返回的是结果列表对象，不直接重写整棵树
5. 搜索结果展示完整路径与高亮
6. 用户点击结果后，再定位回树中的真实节点

ZooCute 应当尽量复刻这个思路，而不是做“树内即时裁剪过滤”。

---

## 设计原则

- 树渲染与搜索逻辑分离
- 搜索数据来源于缓存索引，不直接来源于 UI 组件
- 搜索结果以“结果列表”形态存在
- 搜索不破坏用户当前树展开状态
- 搜索命中后通过“定位动作”跳转到树节点
- 首版搜索范围限定为“当前已缓存节点”

---

## 范围定义

### 本次包含

- 当前活动会话内的节点缓存
- 基于缓存的路径搜索
- 独立搜索结果列表
- 结果项高亮
- 点击结果后定位树节点
- 必要时按祖先链逐层加载并展开

### 本次不包含

- 跨所有连接统一搜索
- 直接查询 ZooKeeper 全量路径
- 正则搜索
- 模糊拼写纠错
- 内容全文搜索

---

## 一、总体架构

建议引入四层结构：

1. Tree State
2. Search Cache
3. Search Index
4. Search Result View

### 1. Tree State

现有 `treeNodes`、`expandedPaths`、`loadingPaths` 继续负责树展示。

### 2. Search Cache

新增“当前会话已缓存节点”的统一存储，保存所有已经加载到客户端的节点元信息。

### 3. Search Index

在 Search Cache 之上维护用于搜索的数据结构（`PathSearchIndex`）。首版内部用 Map 线性扫描实现，对外接口形状与 PrettyZoo 概念对齐，内部实现可替换。

### 4. Search Result View

搜索结果以列表单独展示，不直接改写原树。

---

## 二、数据结构设计

### 1. CachedNode

建议定义独立缓存结构：

```ts
interface CachedNode {
  path: string;
  name: string;
  parentPath: string | null;
  hasChildren: boolean;
  loadedChildren: boolean;
}
```

### 2. SearchResult

建议单独定义结果结构：

```ts
interface SearchResult {
  path: string;
  name: string;
}
```

说明：

- `path` 用于定位，也是结果项的唯一 key
- `name` 用于主展示
- `segments`（`path.split('/')`）在渲染时现算，无需存储
- 关键字高亮在渲染层处理（字符串切割），不存 HTML 字符串，避免 XSS 风险

### 3. SearchStore

每个活动 session 独立维护一份搜索缓存：

```ts
interface SessionSearchStore {
  byPath: Map<string, CachedNode>;
}
```

`childrenByParent` 不存储，按需从 `byPath` 筛 `parentPath === path` 派生，避免两份数据不同步。

---

## 三、索引模型

### 推荐结构

新增一个纯前端搜索索引模块：

- `src/lib/path-search-index.ts`

对外接口（与 PrettyZoo 概念对齐）：

```ts
interface PathSearchIndex {
  insert(node: CachedNode): void;
  remove(path: string): void;
  search(keyword: string): SearchResult[];
  clear(): void;
}
```

### 内部实现

**首版用 `Map<string, CachedNode>` + 线性扫描**，不建 Trie。

理由：Trie 加速的是”前缀查找”，而 ZooCute 这里是 `name.includes(keyword)` 子串匹配，Trie 对子串无加速效果；当前缓存规模（数百到数千节点）线性扫描完全够用。接口已预留，待真正出现性能问题再换实现，不影响调用方。

### 搜索规则

- 主匹配 `name`（最后一段路径），大小写不敏感
- `name` 不命中时，补充匹配完整 `path`

### 结果排序

搜索结果按以下优先级排序，保证列表稳定不跳动：

1. `name` 精确相等优先
2. `name` 前缀匹配次之
3. 其余按路径长度升序
4. 最后按路径字典序

---

## 四、缓存更新时机

### 实现注意：所有缓存写入统一在 `ensureChildrenLoaded` 成功回调中同步触发

当前 `useWorkbenchState` 里 `ensureChildrenLoaded` 成功后调用 `mergeChildren` 更新 `treeNodes`，**缓存写入应在同一个成功回调里追加调用 `indexNodes`**，不走 `useEffect` 监听 `treeNodes`（难以精确 diff，且有额外渲染周期开销）。

```
ensureChildrenLoaded 成功
  -> mergeChildren(treeNodes)      ← 已有
  -> indexNodes(connectionId, newChildren)  ← 新增
```

### 1. 建立连接后

`submitConnection` 里 `listChildren` 根节点成功后，将根子节点写入缓存与索引。

### 2. 节点展开后

`ensureChildrenLoaded` 成功后批量写入新增节点。

### 3. 节点刷新后

force refresh 时，在成功回调里：先对旧子节点执行 `removeNodes`（按父路径批量删除），再对新子节点执行 `insertNodes`。

### 4. 创建节点后

创建成功后触发父节点 force refresh，走流程 3。

### 5. 删除节点后

删除成功后触发父节点 force refresh，走流程 3。
若被删路径在缓存中有子路径，需递归移除（按前缀匹配 `byPath` 中所有以该路径开头的条目）。

### 6. 断开连接后

`removeSession` 时清空该 session 的 `searchStore`，无需额外操作（session 整体丢弃）。

---

## 五、UI 交互设计

### 1. 搜索框行为

搜索框仍位于左侧树面板顶部，但行为改为：

- 输入关键字时不直接过滤树
- 当关键字非空时，左侧主区域切换为”搜索结果视图”
- 当关键字为空时，恢复普通树视图

**Tab 切换行为**：`searchQuery` 按 session 独立存储（存在 `use-node-search` 内部的 `Map<connectionId, string>` 里）。切换到另一个 Tab 时，搜索框自动显示该 Tab 上次的搜索词，互不干扰。`BrowserPane` 的搜索框改为受控组件（由 hook 控制 `value`），不再自己维护 `useState`。

### 2. 搜索结果视图

建议展示为竖向列表，每一项包含：

- 节点名
- 完整路径
- 关键字高亮

可选附加信息：

- 是否已加载完整父链
- 节点类型图标

### 3. 空状态

未命中时显示：

- `未找到匹配的已缓存节点`

并在副文案中明确：

- `当前搜索范围仅包含本次会话已加载的节点`

### 4. 命中结果点击行为

点击结果项后执行“定位”：

1. 切回树视图
2. 按路径拆分祖先链
3. 若祖先链中存在未加载层级，逐层加载
4. 自动展开祖先路径
5. 高亮目标节点
6. 打开目标节点详情

---

## 六、定位算法

为了贴近 PrettyZoo，搜索与定位应是两个阶段。

### 阶段 1：搜索

输入关键字后，从索引中获得候选结果：

```text
keyword -> searchIndex.search(keyword) -> SearchResult[]
```

### 阶段 2：定位

点击某结果后，执行定位流程：

```text
result.path
-> split ancestors
-> ensure each ancestor children loaded
-> expand ancestor chain
-> select node
-> open node details
```

### 定位注意点

- 若某级父节点尚未加载，需要顺序 await
- 若路径在缓存中存在但树尚未展开，也需要同步展开状态
- 若服务端已发生变化，定位失败时需要给出错误反馈

---

## 七、状态管理与集成架构

### 新增 `use-node-search.ts` hook

独立 hook，在 `useWorkbenchState` 内部初始化，注入所需依赖：

```ts
const nodeSearch = useNodeSearch({
  activeTabId,
  ensureChildrenLoaded,   // 带 connectionId 的原始版本
  updateSession,
  openNode,
});
```

**对外暴露：**

```ts
{
  // 缓存写入（由 useWorkbenchState 在合适时机调用）
  indexNodes(connectionId: string, nodes: CachedNode[]): void;
  removeNodes(connectionId: string, paths: string[]): void;
  clearSession(connectionId: string): void;

  // 搜索
  searchQuery: string;       // 当前 active tab 的搜索词
  setSearchQuery(q: string): void;
  searchResults: SearchResult[];
  searchMode: "tree" | "results";

  // 定位（点击结果后调用）
  locate(path: string): Promise<void>;
}
```

### `use-node-search` 内部状态

```ts
// 每个 session 独立的缓存和搜索词
const stores = useRef<Map<string, SessionSearchStore>>(new Map());
const queries = useRef<Map<string, string>>(new Map());
```

用 `useRef` 而非 `useState` 存储缓存，避免每次写入触发不必要的重渲染；搜索词用 `useState` 存（需要触发结果更新）。

### `locate` 的实现依赖

`locate` 需要：

1. 按路径拆出祖先链：`/a/b/c` → `["/a", "/a/b", "/a/b/c"]`
2. 对每个祖先顺序调用 `ensureChildrenLoaded(activeTabId, ancestor)`
3. 逐层展开 expandedPaths（通过 `updateSession`）
4. 调用 `openNode(path)` 打开节点详情
5. 清空 `searchQuery`，退出搜索模式

`locate` 中使用的 `ensureChildrenLoaded` 必须是**带 `connectionId` 参数的原始版本**（不是 `useWorkbenchState` 对外导出的简化版）。

### `useWorkbenchState` 的改动

- 调用 `nodeSearch.indexNodes` 的位置：`ensureChildrenLoaded` 成功回调、`submitConnection` 成功后
- 调用 `nodeSearch.removeNodes` 的位置：`ensureChildrenLoaded` force refresh 成功后（先 remove 旧的，再 insert 新的）
- 调用 `nodeSearch.clearSession` 的位置：`disconnectSession`
- 将 `nodeSearch` 的 `searchQuery`、`setSearchQuery`、`searchResults`、`searchMode`、`locate` 通过 `useWorkbenchState` 的返回值透传给 `App.tsx`

---

## 八、与当前实现的差异

当前实现：

- 树即搜索
- 搜索即过滤
- 只作用于顶层

PrettyZoo 风格实现：

- 树与搜索解耦
- 搜索基于缓存索引
- 搜索结果独立显示
- 点击结果再回定位树

这两种模式的差异很大，因此建议不要在现有 `visible = treeNodes.filter(...)` 的逻辑上硬改，而是直接替换为新模型。

---

## 九、测试策略

至少需要覆盖以下用例：

### 1. 索引建立

- 根节点加载后可被搜索到
- 子节点懒加载后可被搜索到

### 2. 搜索结果

- 输入关键字返回结果列表
- 关键字为空时退出搜索模式
- 未命中时显示空状态

### 3. 定位行为

- 点击结果后自动展开祖先链
- 点击结果后高亮目标节点
- 点击结果后右侧打开节点详情

### 4. 缓存同步

- 刷新节点后索引更新
- 删除节点后结果消失
- 断开连接后缓存清空

### 5. 结果顺序

排序规则见第三节（索引模型 → 结果排序）。测试时应覆盖：

- 精确匹配排在前缀匹配之前
- 相同优先级内路径短的排前面
- 结果列表在连续输入过程中不发生跳动

---

## 十、分阶段落地建议

### Phase 1：结构对齐 PrettyZoo

- 引入 session 级缓存（`SessionSearchStore`）
- 引入 `PathSearchIndex`（Map 线性扫描实现）
- 搜索结果列表单独展示
- 关键字高亮（渲染层字符串切割）
- 结果排序（按第三节规则）
- 支持点击结果定位（含祖先链懒加载）
- 搜索框改为受控组件，搜索词按 session 独立存储

### Phase 2：体验打磨

- 输入 debounce
- 键盘上下导航与回车打开

### Phase 3：能力增强

- 跨连接搜索
- 内容搜索
- 服务端全量搜索

---

## 十一、推荐结论

如果要求“完全按照 PrettyZoo 的方式来”，ZooCute 最合理的实现方向不是“递归过滤当前树”，而是：

1. 为每个连接维护已缓存节点集合（`SessionSearchStore`）
2. 在缓存之上构建 `PathSearchIndex`（首版 Map 线性扫描，接口预留）
3. 搜索时展示独立结果列表，搜索词按 session 隔离
4. 结果点击后再定位并展开树节点
5. 缓存写入统一在 `ensureChildrenLoaded` 成功回调中同步触发

这会比当前实现多一层缓存和索引维护成本，但能得到更稳定、可扩展、也更贴近 PrettyZoo 的搜索体验。
