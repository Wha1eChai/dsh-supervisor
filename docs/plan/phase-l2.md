# L2 — Fleet 模型工具 Consumer

## 目标

在同一个 npm 包中增加独立入口 `@wha1echai/dsh-supervisor/tool`，通过 `ctx.tools` 暴露标准 `fleet_*` 工具。Consumer 只注入 `tools` 和 `fleet`，不读取 `ctx.agents`、`ctx.sessions` 或 `ctx.subagents`。

L2 不改变 `FleetService` 的 delegated 写入契约。`ctx.subagents.followup()` 需要精确 live parent `Agent` 作为授权，现有 Fleet API 只有 JSON-safe caller id；该能力需要单独设计，不能由工具绕过 Service Definition。

## 插件入口

```text
@wha1echai/dsh-supervisor       Fleet Definition + 默认 Provider
@wha1echai/dsh-supervisor/tool  模型工具 Consumer
```

两个入口都是 Loader-safe namespace plugin，不导出 `default`。

Bundle patch 插入两个独立 row：

```yaml
- insert:
    - id: dsh-supervisor
      name: '@wha1echai/dsh-supervisor'
    - id: dsh-supervisor-tools
      name: '@wha1echai/dsh-supervisor/tool'
```

Consumer row 依赖 `tools` / `fleet`，因此 Provider 或 ToolRuntime 不可用时由 Cordis 保持 pending；Provider 被替换时 Consumer 自动卸载并重载。

## 配置

工具入口导出 Schemastery `Config`：

```ts
interface Config {
  controlMode: 'read-only' | 'message' | 'full'
}
```

默认 `read-only`。

| mode | 注册工具 |
|---|---|
| `read-only` | `fleet_list`, `fleet_inspect` |
| `message` | 只读工具 + `fleet_send`, `fleet_steer` |
| `full` | 全部工具，包括 `fleet_cancel` |

这是部署级可见性选择，不替代 `tools/pre-execute`、approval 或 `ctx.tools.guard()`。配置 HMR 必须撤销旧工具集合并注册新集合。

## 工具契约

### `fleet_list`

参数：

```ts
{
  roots_only?: boolean
  running_only?: boolean
}
```

Canonical output：

```ts
{
  agents: FleetAgentView[]
  count: number
}
```

- 调用 `ctx.fleet.list({ rootsOnly, runningOnly })`。
- 只读并声明 `isConcurrencySafe() === true`。
- 模型文本：无结果时 `No live Fleet sessions.`；有结果时提供数量和完整 JSON-safe agent 数组。
- Generic card：`List Fleet sessions`，`kind: 'search'`。

### `fleet_inspect`

参数：

```ts
{
  session_id: string
  tail_messages?: number
}
```

Canonical output：`FleetInspectView`。

- `session_id` trim 后必须非空。
- `tail_messages` 提供时必须是正安全整数；DSL 不表达 minimum，Consumer 在调用 Service 前校验。
- 只读并声明 `isConcurrencySafe() === true`。
- 模型文本提供目标 id、状态、控制模式和完整 JSON-safe 摘要。
- Generic card：`Inspect Fleet session <id>`，`kind: 'search'`，`rawInput` 只显示 id 和可选 tail 数。

### `fleet_send`

仅 `message` / `full` 注册。

参数：

```ts
{
  session_id: string
  text: string
}
```

Canonical output：

```ts
{
  sessionId: string
  messageId: string
}
```

- 必须有 `exec.agent`；否则抛 `fleet_send requires an owning agent session`。
- `session_id` 和 `text` trim 后必须非空；保留 text 原文交给 Service（只用 trim 判断空值）。
- 调用 `ctx.fleet.send(target, text, { callerSessionId: exec.agent.session.id })`。
- 不声明并发安全；写工具保持 exclusive。
- 模型文本：`Queued follow-up <messageId> for Fleet session <sessionId>.`
- Generic card：`Send message to Fleet session <id>`，`kind: 'execute'`，不在 card 重复完整正文。

### `fleet_steer`

仅 `message` / `full` 注册。参数和 output 与 `fleet_send` 对称。

- 必须有 `exec.agent`，并传 `callerSessionId`。
- 调用 `ctx.fleet.steer(...)`。
- 模型文本：`Submitted steering message <messageId> for Fleet session <sessionId>.`
- Generic card：`Steer Fleet session <id>`，`kind: 'execute'`。

### `fleet_cancel`

仅 `full` 注册。

参数：

```ts
{
  session_id: string
  keep_inbox?: boolean
}
```

Canonical output：

```ts
{
  sessionId: string
  accepted: true
}
```

- 必须有 `exec.agent`，并传 `callerSessionId`。
- `keep_inbox` 未提供时不在 Service options 中伪造值；提供时原样映射为 `keepInbox`。
- 模型文本：`Cancellation accepted for Fleet session <sessionId>.`
- Generic card：`Cancel Fleet session <id>`，`kind: 'execute'`。

## Schema 和输出

- `defineTool()` 的每个 canonical output 使用显式 schema；所有显式 object 都写 `additionalProperties: false`。
- Fleet view schema 在 Consumer 模块集中定义一次，被 list/inspect 复用；字段和 `src/types.ts` 保持对称。
- 可选字段保持省略，不用 `null` 替代。
- `output.render` 只生成模型文本；canonical value 供 Code Mode 和程序化 Consumer 使用。
- `presentCall` / `presentResult` 是参数和 durable result 的纯函数，不读取 Service、Session、时间或随机值。
- 工具失败通过 ToolRuntime 标准 `isError` 路径返回；不要把 `FleetError` 改造成成功 union。

## 调用方身份与安全

- 读工具允许没有 owning Agent 的程序化调用。
- 所有写工具要求 `exec.agent`，并使用 `exec.agent.session.id` 作为唯一 caller id；模型不能传 caller id。
- 工具不得读取 `ctx.agents`，不得直接调用 `Agent`，不得调用 `ctx.subagents`。
- delegated target 继续由 Fleet Provider 返回 `fleet-delegated-write-deferred` / `fleet-observe-only`。
- 自控制继续由 Fleet Provider 返回 `fleet-self-target`。
- 写工具执行前调用 `exec.signal.throwIfAborted()`；同步 Service 接受后不因外层随后取消而假装回滚。

## 测试门禁

### 单元 / ToolRuntime

使用真实 `ToolRuntime` 和真实工具插件，Fleet Service 可以是记录调用的测试 Provider。

必测：

1. namespace entry 无 `default`，`Loader.unwrapExports()` 保留 `name` / `inject` / `Config` / `apply`。
2. `read-only` 只注册 list/inspect；`message` 增加 send/steer；`full` 再增加 cancel。
3. HMR/unload 后五个工具均从 registry 撤销。
4. list 参数映射、canonical output、无结果和有结果 render、generic card。
5. inspect 参数映射、tail 正安全整数校验、canonical output、render、card。
6. send/steer 精确传 target/text/caller，返回 canonical id，并验证 self/delegated Service 错误进入 `isError`。
7. write 工具无 owning Agent 时失败且 Fleet Service 零调用。
8. cancel 映射 caller 和可选 keepInbox；默认不伪造 `keepInbox: false`。
9. list/inspect 是 parallel；send/steer/cancel 是 exclusive。
10. `exec.signal` 预先 abort 时 ToolRuntime 不调用 Fleet Service。
11. 所有 canonical output 可 lossless JSON 序列化；schema 拒绝实现返回的错误字段或类型。
12. Consumer 源码不 import `@deepseek-ai/dsh-agent`（类型身份由 ToolRunContext 提供）或 `@deepseek-ai/dsh-subagent`。

### 真实 Loader composition

通过 test-only `cordis.yml` 和官方 Loader + Include 加载构建产物：

```text
@deepseek-ai/dsh-system-prompt
@deepseek-ai/dsh-tools
@wha1echai/dsh-supervisor
@wha1echai/dsh-supervisor/tool
```

- 从构建后的 package exports 导入两个本包入口。
- 断言五个 schema 在 `controlMode: full` 下可见。
- 通过 `ctx.tools.execute()` 实际调用 `fleet_list`，断言 canonical value 和 model content。
- disable Consumer entry 后工具消失，但 `ctx.fleet` 仍存在。
- disable Provider entry 后 Consumer 进入 pending / 不可见，不能保留陈旧工具调用。

## 文档和发布

- 更新英文/中文 README：状态从 Service Preview 变为 Tool Preview，标记 L2 完成，并给出 profile config 示例。
- 更新 [../reference/fleet.md](../reference/fleet.md) 的工具章节和安全模式。
- `package.json` 导出 `./tool`，peer/dev dependency 增加精确 `@deepseek-ai/dsh-tools@0.1.0-rc.6`；测试需要的 `dsh-system-prompt` 只放 dev dependency，除非运行时入口直接 import。
- tarball 必须包含 `dist/tool*` 及其声明。

## 不做

- delegated child followup / interrupt 的 Service API 重设计（后续 L2b）
- supervisor preset / workflow 组合（L3）
- transport、Electron、daemon
- npm publish 或 GitHub Release
