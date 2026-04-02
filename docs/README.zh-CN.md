# Zoocute 开发说明

Zoocute 是一个基于 Tauri、Rust、React 和 TypeScript 构建的 ZooKeeper 桌面客户端，面向日常开发与运维场景，支持连接集群、浏览节点树、查看节点元数据、编辑文本内容、查看操作日志，以及通过解析插件解码节点数据。

英文版开发说明见 [README.md](../README.md)。  
用户文档见 [USER_GUIDE.md](../USER_GUIDE.md) 和 [docs/USER_GUIDE.zh-CN.md](USER_GUIDE.zh-CN.md)。

## 功能概览

- 基于 Tauri 2 的桌面应用
- 连接 ZooKeeper 集群并管理连接配置
- 浏览节点树并查看节点详情
- 在会话内建立搜索索引后搜索节点
- 查看节点版本、时间戳、子节点数量、数据长度等元信息
- 编辑并保存可编辑的文本类节点内容
- 对比本地草稿与服务端最新值
- 创建和删除节点
- 查看最近的 ZooKeeper 操作日志
- 通过解析插件将原始节点字节流转换为可读内容

## 技术栈

- 前端：React 19、TypeScript、Vite
- 桌面容器：Tauri 2
- 后端：Rust
- ZooKeeper 客户端：`zookeeper-client`
- 测试：Vitest、`cargo test`

## 环境要求

开始开发前请确保本机已安装：

- Node.js 20+ 与 npm
- Rust stable 工具链
- 当前操作系统对应的 Tauri 开发依赖

Tauri 官方环境要求：
- macOS：[Tauri prerequisites](https://tauri.app/start/prerequisites/)
- Windows：[Tauri prerequisites](https://tauri.app/start/prerequisites/)
- Linux：[Tauri prerequisites](https://tauri.app/start/prerequisites/)

## 快速开始

安装前端依赖：

```bash
npm install
```

仅启动前端开发服务器：

```bash
npm run dev
```

启动 Tauri 桌面开发环境：

```bash
npm run tauri:dev
```

## 常用命令

```bash
# 前端测试
npm test

# 前端构建
npm run build

# Rust 测试
cargo test --manifest-path src-tauri/Cargo.toml
```

## 目录结构

```text
src/                 React 界面、hooks、命令桥接与前端测试
src-tauri/           Rust 后端、Tauri 启动逻辑、集成测试
docs/                中文文档与评审记录
vite.config.ts       Vite 与 Vitest 配置
package.json         前端脚本与依赖定义
```

关键文件：

- [src/App.tsx](../src/App.tsx)：应用主布局与工作区装配
- [src/hooks/use-workbench-state.ts](../src/hooks/use-workbench-state.ts)：核心状态管理与 ZooKeeper 交互流程
- [src/lib/commands.ts](../src/lib/commands.ts)：前端到 Tauri 的命令桥
- [src-tauri/src/commands.rs](../src-tauri/src/commands.rs)：Rust 侧命令处理
- [src-tauri/src/lib.rs](../src-tauri/src/lib.rs)：Tauri 应用初始化与命令注册

## 开发说明

### 连接管理

- 连接配置主要通过界面维护。
- 当前代码里新建连接默认超时为 `5000 ms`。
- 用户名和密码字段在表单中是可选项，但是否能访问取决于目标 ZooKeeper 集群的认证与权限配置。

### 节点搜索

- 搜索能力依赖当前会话已经加载到本地缓存中的节点。
- 应用会在后台递归拉取完整树结构，因此连接保持一段时间后，搜索结果通常会更完整。

### 操作日志

- 应用会在本地持久化 ZooKeeper 操作日志。
- Rust 启动逻辑会在 Tauri 的应用数据目录下初始化日志目录，并写入 `logs/zookeeper-debug.jsonl`。

### 解析插件

- 解析插件从应用数据目录下的 `plugins/` 中发现。
- 插件目录中需要提供有效的 `plugin.json` 清单文件。
- 后端对插件执行设置了超时限制，避免插件阻塞界面。

#### 插件发现机制

- 插件根目录位于 Tauri 应用数据目录下。
- Zoocute 会扫描 `plugins/` 下的每一个一级子目录。
- 只有目录中存在 `plugin.json` 时，才会被当作一个候选插件。
- 如果插件声明了 `"enabled": false`，启动发现时会跳过。
- 如果多个已启用插件使用了相同的 `id`，本次发现会报错。
- 清单文件不合法的插件不会显示出来，但会记录发现告警。

目录示例：

```text
<app-data-dir>/
  plugins/
    dubbo-provider/
      plugin.json
      decoder.py
```

#### `plugin.json` 格式

当前 Rust 后端支持的清单字段如下：

```json
{
  "id": "dubbo-provider",
  "name": "Dubbo Provider Decoder",
  "enabled": true,
  "command": "python3",
  "args": ["decoder.py"]
}
```

字段说明：

- `id`：插件唯一标识，前后端都依赖它
- `name`：显示在编辑器工具栏中的名称
- `enabled`：可选，默认值为 `true`
- `command`：实际启动的可执行命令
- `args`：可选，传给命令的参数数组

其中 `id`、`name` 和 `command` 必须是非空字符串。

#### 插件执行流程

- 当前端打开一个节点时，会先请求可用插件列表。
- 只有存在可用插件时，编辑器工具栏才会显示插件下拉框。
- 用户选择插件并点击 `Parse` 后，前端会调用 `run_parser_plugin`。
- 后端会读取当前节点的原始字节，并以插件目录作为工作目录启动配置好的命令。
- Zoocute 会把节点的原始字节写入插件进程的 `stdin`。
- 插件需要把可读的解析结果写到 `stdout`。
- 执行成功后，前端会保存结果，并开放 `PLUGIN` 视图标签。

也就是说，插件可以用任意语言实现，只要它能做到：

- 从标准输入读取原始字节
- 把解析后的文本写到标准输出
- 在超时窗口内正常退出

#### 失败与超时处理

- 如果插件以非零退出码结束，界面会显示错误信息，并尽量带上 `stderr` 内容。
- 如果插件长时间无响应，后端会主动终止该进程。
- 当前命令执行超时为 `5000 ms`。
- 对于损坏的清单文件，发现阶段的告警会写入 ZooKeeper 日志存储。

现有 Rust 测试已经覆盖：

- 正常读取 `stdout`
- 非零退出码错误透传
- 超时终止

参考 [src-tauri/tests/parser_plugin_command_tests.rs](../src-tauri/tests/parser_plugin_command_tests.rs)。

#### 最小可用插件示例

下面这个例子会从 `stdin` 中读取前 4 个字节，并输出十六进制结果：

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

#### 插件开发建议

- 尽量使用目标环境中稳定可用的命令运行时。
- 插件应保持快速、确定性强，因为它运行在编辑器交互链路上。
- 输入应当按原始字节处理，不要默认它一定是 UTF-8 文本。
- 给用户展示的解析结果写到 `stdout`。
- 如果希望失败时更容易排查，可以把诊断信息写到 `stderr`。
- `id` 建议保持稳定，修改后应用会把它当作一个新的插件。

## 测试建议

前端测试：

```bash
npm test
```

Rust 测试：

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

如果你修改了命令桥接、搜索逻辑、插件执行流程或会话状态管理，建议两套测试都跑一遍。

## 文档入口

- 英文开发说明：[README.md](../README.md)
- 中文开发说明：[docs/README.zh-CN.md](README.zh-CN.md)
- 英文用户文档：[USER_GUIDE.md](../USER_GUIDE.md)
- 中文用户文档：[docs/USER_GUIDE.zh-CN.md](USER_GUIDE.zh-CN.md)
