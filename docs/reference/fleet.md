# Fleet API 参考

宿主进程通过主入口提供 `ctx.fleet`，独立 `@wha1echai/dsh-supervisor/tool` 入口把该服务暴露为模型工具。Consumer 必须注入 `fleet`，不得直接依赖 `ctx.agents`。

当前 Provider 只访问同一运行中 DSH runtime（即同一个 `dsh` 进程）的 live Agent。它不提供跨进程、跨终端或跨设备、本地到服务器、remote Web、gateway、daemon 或多 runtime 路由。

## 安装

```powershell
dsh plugin --profile web add D:\coding\programs\dsh\dsh-supervisor
dsh --profile web --dump-config
dsh --profile web
```

开发和测试必须设置隔离的 `DSH_HOME`，不要修改现有用户 profile。这里的 `web` profile 只是现有 DSH 宿主，不表示本插件提供 remote Web 或多 Session UI。

## 配置

Bundle row 可在 profile patch 中整体重写配置：

```yaml
- id: dsh-supervisor
  name: '@wha1echai/dsh-supervisor'
  config:
    defaultTailMessages: 8
    maxTailMessages: 32
    maxMessageTextChars: 2000
```

| 字段 | 默认值 | 约束 | 含义 |
|---|---:|---|---|
| `defaultTailMessages` | 8 | 正安全整数，不大于 `maxTailMessages` | `inspect()` 未指定数量时返回的尾部消息数 |
| `maxTailMessages` | 32 | 正安全整数 | 单次 `inspect()` 的尾部消息上限 |
| `maxMessageTextChars` | 2000 | 正安全整数 | 每条摘要的文本字符上限 |

无效配置在插件加载时失败。

## 工具配置与发现

Bundle 插入独立的 `dsh-supervisor-tools` 行。只有该 Consumer 实际挂载时，`fleet_*` 才会注册。默认 `controlMode: read-only`，可在 profile 的 `cordis.patch.yml` 中完整覆盖该行：

```yaml
- id: dsh-supervisor-tools
  name: '@wha1echai/dsh-supervisor/tool'
  config:
    controlMode: message
```

| `controlMode` | 模型可见工具 |
|---|---|
| `read-only` | `fleet_list`、`fleet_inspect` |
| `message` | 只读工具 + `fleet_send`、`fleet_steer` |
| `full` | 全部工具，包括 `fleet_cancel` |

`controlMode` 是部署级可见性选择，不替代 `tools/pre-execute`、approval 或 `ctx.tools.guard()`。配置 HMR 会撤销旧工具集合再注册新集合。

已运行的 Session 会在下一次模型请求中通过正常 ToolRuntime 组合看到当前注册的工具；不生成聊天消息，也不需要只用于工具广告的常驻 system prompt prose。该入口只注册 `fleet_*`，不注册或宣传 subagent/workflow 工具；这些能力必须由对应公开 seam 和官方 Consumer 独立挂载。

## 模型工具

| 工具 | 参数 | Canonical output | 并发 |
|---|---|---|---|
| `fleet_list` | `roots_only?`、`running_only?` | `{ agents: FleetAgentView[], count: number }` | parallel |
| `fleet_inspect` | `session_id`、`tail_messages?` | `FleetInspectView` | parallel |
| `fleet_send` | `session_id`、`text` | `{ sessionId, messageId }` | exclusive |
| `fleet_steer` | `session_id`、`text` | `{ sessionId, messageId }` | exclusive |
| `fleet_cancel` | `session_id`、`keep_inbox?` | `{ sessionId, accepted: true }` | exclusive |

`fleet_list` 返回：

```ts
{
  agents: FleetAgentView[]
  count: number
}
```

每个 `FleetAgentView` 都包含 `sessionId`。它是当前 DSH runtime 内 inspect/send/steer/cancel 的 canonical routing identifier。未来任何 Session-list UI 必须原样展示它并提供复制操作；当前 package 不提供该 UI。它也不是已定义的跨 runtime 或全局远程地址。

`session_id` 会 trim 后再调用 Service，并且不能为空。`fleet_inspect.tail_messages` 必须是正安全整数。`fleet_send` / `fleet_steer` 只用 trim 判断正文是否为空，传给 Service 的仍是原始 `text`。`fleet_cancel` 未提供 `keep_inbox` 时不会伪造 `keepInbox: false`。

读工具允许 agentless 程序化调用。所有写工具要求 owning Agent，并且只从 `exec.agent.session.id` 派生 `callerSessionId`；模型参数中没有 caller id。预先 abort 的写调用在进入 Fleet Service 前失败。`@deepseek-ai/dsh-tools@0.1.0-rc.6` 若在 Fleet Service 已同步接受写入后、工具结果最终物化前收到 caller cancellation，会返回 `ABORTED`；该结果不表示 Fleet 写入回滚，调用方应通过后续读工具重新观察状态。其他工具错误同样通过 ToolRuntime 的 `isError` 结果返回，不包装成成功 union。

五个工具都使用 generic card：list/inspect 为 `search`，send/steer/cancel 为 `execute`。Canonical value 供 Code Mode 和程序化 Consumer 使用，模型文本由工具的 `output.render` 生成。Card presenter 对 replay 参数安全解析；空白 `session_id`、无效 `tail_messages` 或其他无效 card 参数返回 `undefined`，由 ToolRuntime 使用 generic fallback。

## Service

```ts
ctx.fleet.list(filter?)
ctx.fleet.inspect(sessionId, options?)
ctx.fleet.send(sessionId, text, caller?)
ctx.fleet.steer(sessionId, text, caller?)
ctx.fleet.cancel(sessionId, options?)
ctx.fleet.subscribe(listener)
```

### `list`

只返回当前 DSH runtime，也就是当前 `dsh` 进程中的 live Agent。`rootsOnly` 按当前 `kind` 投影排除 delegated Agent；`runningOnly` 只保留 `status === 'running'`。

### `inspect`

返回 Agent 视图和经过限量、截断的 user/assistant 文本摘要。不会返回 `Agent`、`Session` 或原始事件数组。

### `send` / `steer`

当前只写被 Provider 分类为 live root 的 Agent。消息来源固定为：

```ts
{ kind: 'plugin', plugin: 'dsh-supervisor' }
```

传入与目标相同的 `callerSessionId` 会被拒绝。

### `cancel`

当前只取消被 Provider 分类为 live root 的 Agent，原因固定为：

```ts
{ kind: 'hook', reason: 'fleet-cancel' }
```

`keepInbox` 原样传给 Agent。

### `subscribe`

事件类型为 `created`、`status`、`disposed`。返回的 disposer 幂等。listener 的同步异常或 Promise 拒绝会被记录，不影响 Agent 生命周期和其他 listener。

## Agent 视图

```ts
interface FleetAgentView {
  sessionId: string
  status: AgentStatus
  kind: 'root' | 'delegated'
  control: 'direct' | 'subagent' | 'observe-only'
  parentSessionId?: string
  cwd?: string
  blank: boolean
  queueCount: number
  updatedAt?: number
}
```

当前实现中，`origin === 'subagent'` 或存在 `parentSession` 时，Agent 被归类为 `delegated`。这是 lineage 元数据启发式，不是最终 authoritative runtime-root classification。目标权威来源是 `ctx.agents.roots()`，该 correctness fix 仍待完成。

因此，当前 `kind`、`control`、`rootsOnly` 以及依赖该分类的 root 写授权或 delegated 写错误可能受误分类影响，不能描述为对所有 runtime root/child 都已正确。

当前版本不写被推断为 delegated 的 Agent：存在 `ctx.subagents` 时返回 `fleet-delegated-write-deferred`；不存在时返回 `fleet-observe-only`。后续 L2b 需要给 Fleet Service 设计携带精确 parent authority 的 API，工具 Consumer 不会绕过 Service Definition 直接调用 subagent seam。

## 错误码

`FleetError.code` 是 Consumer 和后续可能的 transport 使用的稳定字段。

| code | 条件 |
|---|---|
| `fleet-unavailable` | Provider 已卸载，旧 Service 引用不再可用 |
| `fleet-not-found` | 当前 DSH runtime 的 live Fleet 中没有该 `sessionId` |
| `fleet-self-target` | 调用方控制自己 |
| `fleet-delegated-write-deferred` | 被分类为 delegated 的 Session 可由 subagent seam 控制，但当前 Fleet API 尚未携带精确 parent authority |
| `fleet-observe-only` | 被分类为 delegated 的 Session 没有可用 subagent seam |
| `fleet-empty-text` | send/steer 文本为空或仅含空白 |
