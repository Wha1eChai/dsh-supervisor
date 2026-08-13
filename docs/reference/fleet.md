# Fleet API 参考

L1 在宿主进程提供 `ctx.fleet`。Consumer 必须注入 `fleet`，不得直接依赖 `ctx.agents`。

## 安装

```powershell
dsh plugin --profile web add D:\coding\programs\dsh\dsh-supervisor
dsh --profile web --dump-config
dsh --profile web
```

开发和测试必须设置隔离的 `DSH_HOME`，不要修改现有用户 profile。

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

只返回当前进程中的 live Agent。`rootsOnly` 排除 delegated Agent；`runningOnly` 只保留 `status === 'running'`。

### `inspect`

返回 Agent 视图和经过限量、截断的 user/assistant 文本摘要。不会返回 `Agent`、`Session` 或原始事件数组。

### `send` / `steer`

只写 live root Agent。消息来源固定为：

```ts
{ kind: 'plugin', plugin: 'dsh-supervisor' }
```

传入与目标相同的 `callerSessionId` 会被拒绝。

### `cancel`

只取消 live root Agent，原因固定为：

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

`origin === 'subagent'` 或存在 `parentSession` 时，Agent 归类为 `delegated`。

L1 不写 delegated Agent：存在 `ctx.subagents` 时返回 `fleet-delegated-write-deferred`；不存在时返回 `fleet-observe-only`。L2 才通过公开 subagent seam 接上继续写入和中断。

## 错误码

`FleetError.code` 是 Consumer 和后续传输使用的稳定字段。

| code | 条件 |
|---|---|
| `fleet-unavailable` | Provider 已卸载，旧 Service 引用不再可用 |
| `fleet-not-found` | 当前进程没有该 live Session |
| `fleet-self-target` | 调用方控制自己 |
| `fleet-delegated-write-deferred` | child 可由 subagent seam 控制，但 L1 尚未接入写路径 |
| `fleet-observe-only` | child 没有可用 subagent seam |
| `fleet-empty-text` | send/steer 文本为空或仅含空白 |
