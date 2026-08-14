# Fleet API 参考

宿主进程通过主入口提供 `ctx.fleet`，独立 `@wha1echai/dsh-supervisor/tool` 入口把该服务暴露为模型工具。Consumer 必须注入 `fleet`，不得直接依赖 `ctx.agents`。

当前 Provider 只访问同一运行中 DSH runtime（即同一个 `dsh` 进程）的 live Agent。它不提供跨进程、跨终端或跨设备、本地到服务器、remote Web、gateway、daemon 或多 runtime 路由。

## 配置

```yaml
- id: dsh-supervisor
  name: '@wha1echai/dsh-supervisor'
  config:
    defaultTailMessages: 8
    maxTailMessages: 32
    maxMessageTextChars: 2000
    targetRefTtlMs: 300000
    selectionTtlMs: 60000
    maxSelectionsPerCaller: 32
```

| 字段 | 默认值 | 约束 | 含义 |
|---|---:|---|---|
| `defaultTailMessages` | 8 | 正安全整数，不大于 `maxTailMessages` | direct/confirmed inspect 的默认尾部消息数 |
| `maxTailMessages` | 32 | 正安全整数 | 单次 inspect 的尾部消息上限 |
| `maxMessageTextChars` | 2000 | 正安全整数 | 每条摘要的文本字符上限 |
| `targetRefTtlMs` | 300000 | 正安全整数 | caller-bound target reference 有效期 |
| `selectionTtlMs` | 60000 | 正安全整数 | single-attempt write selection 有效期 |
| `maxSelectionsPerCaller` | 32 | 正安全整数 | 每个 exact caller 保留的最大 live selection 数 |

Expiry 采用 lazy prune，不运行后台 timer。Selection 超限时淘汰最旧记录。

## 工具配置与发现

独立 `dsh-supervisor-tools` row 默认 `controlMode: read-only`：

| `controlMode` | 模型可见工具 |
|---|---|
| `read-only` | `fleet_list`、`fleet_inspect` |
| `message` | 只读工具 + `fleet_send`、`fleet_steer` |
| `full` | 全部工具，包括 `fleet_cancel` |

已运行 Session 在下一次模型请求中通过正常 ToolRuntime composition 看到当前工具。该入口只注册 `fleet_*`，不注册或宣传 subagent/workflow 工具。

五个工具都要求 owning Agent，并且只从 `exec.agent.session.id` 派生 caller identity。模型不能提交 caller id。List/inspect 为 parallel；send/steer/cancel 为 exclusive。

## 模型 confirmed-target protocol

```text
fleet_list
  -> caller-bound target_ref
fleet_inspect(target_ref)
  -> exact-Agent-bound selection_handle when writable
fleet_send / fleet_steer / fleet_cancel(selection_handle)
```

模型不再为 inspect/write 提交 `session_id`，也没有 direct-ID fallback。Handle 是 byte-exact opaque value，不做 trim 或其他规范化；损坏、带首尾空白或错误的 handle 只会失效，不会被解析为 Session ID 或替换成其他目标。

| 工具 | 参数 | Canonical output |
|---|---|---|
| `fleet_list` | `roots_only?`, `running_only?` | `{ agents: FleetTargetView[], count }` |
| `fleet_inspect` | `target_ref`, `tail_messages?` | `{ agent: FleetInspectView, selection? }` |
| `fleet_send` | `selection_handle`, `text` | `{ sessionId, messageId, deliveryId }` |
| `fleet_steer` | `selection_handle`, `text` | `{ sessionId, messageId, deliveryId }` |
| `fleet_cancel` | `selection_handle`, `keep_inbox?` | `{ sessionId, accepted: true }` |

`FleetTargetView` 包含完整 `FleetAgentView`，并增加：

```ts
{
  targetRef: string
  targetRefExpiresAt: number
}
```

`fleet_inspect` 返回：

```ts
{
  agent: FleetInspectView
  selection?: {
    handle: string
    expiresAt: number
  }
}
```

Self target 和 runtime delegated target 可以 inspect，但不返回 selection。写成功结果中的 `sessionId` 来自 Provider 的 exact target record，Consumer 不从 handle 或模型输入推断。

Selection 固定 single-attempt。空文本等输入失败发生在消费前；所有 caller、target 和当前写授权检查通过后，在调用 Agent 副作用前消费。Agent 方法抛错或 ToolRuntime late abort 都不恢复 selection。

## Service

可信程序化 Consumer 可继续使用 direct lane：

```ts
ctx.fleet.list(filter?)
ctx.fleet.inspect(sessionId, options?)
ctx.fleet.send(sessionId, text, caller?)
ctx.fleet.steer(sessionId, text, caller?)
ctx.fleet.cancel(sessionId, options?)
ctx.fleet.subscribe(listener)
```

模型工具使用 confirmed-target lane：

```ts
ctx.fleet.listTargets(options)
ctx.fleet.inspectTarget(targetRef, options)
ctx.fleet.sendSelected(selectionHandle, text, options)
ctx.fleet.steerSelected(selectionHandle, text, options)
ctx.fleet.cancelSelected(selectionHandle, options)
```

两类 handle 只由 Provider 保存，并同时绑定：

- exact caller Agent 与 `callerSessionId`；
- exact target Agent 与原始 `sessionId`；
- 当前 Provider instance；
- expiry。

每次使用都重新检查 `ctx.agents.get(id) === exactAgent`。Caller/target disposal、同 ID replacement、expiry、caller mismatch、Provider unload 和重复 selection 使用都会 fail closed。Provider unload 后 retained Service reference 不读取 AgentRegistry。

Direct `send` / `steer` 的消息来源固定为：

```ts
{ kind: 'plugin', plugin: 'dsh-supervisor' }
```

Confirmed-target selected `send` / `steer` 使用 versioned `fleet-relay` source：

```ts
{
  kind: 'fleet-relay'
  version: 1
  form: 'relay'
  senderSessionId: SessionId
  deliveryId: FleetDeliveryId
}
```

`senderSessionId` 只能来自 Provider 保存的 exact caller Agent；`deliveryId` 由 Provider 生成，用于 receipt 和 inspect correlation。工具输入、标题、target reference、selection handle 和正文都不能覆盖这些字段。正文以 encoded sender header 加原始 body 的独立 text blocks 发送；正文是不可信模型输入，不参与授权或 correlation 解析。Direct caller 的字符串 `callerSessionId` 不会伪造 relay source。

Direct/selected `cancel` 的原因固定为：

```ts
{ kind: 'hook', reason: 'fleet-cancel' }
```

## Agent 视图与 runtime ownership

```ts
interface FleetAgentView {
  sessionId: string
  status: AgentStatus
  kind: 'root' | 'delegated'
  control: 'direct' | 'subagent' | 'observe-only'
  title?: string
  parentSessionId?: string
  cwd?: string
  blank: boolean
  queueCount: number
  updatedAt?: number
}
```

`kind` 的唯一权威来源是 exact live Agent 是否属于 `ctx.agents.roots()`。Durable `origin` 和 `parentSession` 不参与 runtime classification 或授权；`parentSession` 只投影为 lineage metadata。

Runtime delegated Agent 保持只读：有 `ctx.subagents` 时 direct write 返回 `fleet-delegated-write-deferred`，否则返回 `fleet-observe-only`。Confirmed inspect 不为 delegated target 签发 selection。L2b 才会设计精确 parent authority 的 child write API。

`title` 是可选的展示字段，只在 `sessionTitle` 服务可用且 exact live Session 的日志中已有 `session/title` 时出现。Fleet 只调用 `get(agent.session)`，不调用 `refresh`、`register` 或任何标题 Provider；服务缺失、卸载或没有已记录标题时省略该字段。标题不参与 Session identity、list 顺序、过滤、target reference、selection、路由或授权。

`FleetInspectView` 还包含 `omittedMessages` 和 `tailMessages`。Relay 消息的摘要可带窄 `relay` 投影 `{ version, form, senderSessionId, deliveryId }`；不会暴露 target reference 或 selection handle。`omittedMessages` 只统计过滤出 user/assistant 后因 tail 上限省略的消息数，不统计 tool、reasoning 或其他角色。每条 `FleetMessageSummary.textTruncated` 只表示当前摘要的原始文本超过 `maxMessageTextChars`，与 tail omission 独立。

## 错误码

`FleetError` 继承 DSH `HarnessError`，真实 ToolRuntime 保留：

```json
{
  "name": "FleetError",
  "code": "fleet-selection-invalid"
}
```

每个 `FleetError` 同时提供：

```json
{
  "actionTaken": false,
  "targetSubstitutionAllowed": false,
  "nextAction": "relist-or-ask-user"
}
```

| code | 条件 |
|---|---|
| `fleet-unavailable` | Provider 已卸载 |
| `fleet-not-found` | direct API 找不到 live `sessionId` |
| `fleet-self-target` | direct caller 控制自己 |
| `fleet-delegated-write-deferred` | delegated write 需要未来 L2b parent authority |
| `fleet-observe-only` | delegated target 没有可用 subagent seam |
| `fleet-empty-text` | send/steer 文本为空 |
| `fleet-caller-unavailable` | confirmed-target caller 已不是 exact live Agent |
| `fleet-target-reference-invalid` | target reference unknown、expired、mismatched 或 stale |
| `fleet-selection-invalid` | selection unknown、expired、mismatched、stale 或已消费 |

Selected write receipt 的 `messageId` 是消息 correlation，`deliveryId` 是 Provider 生成的 relay observability identity。Receipt 只代表 Agent inbox 方法同步接受，不表示目标已 claim、完成 turn 或产生 reply；selected steer 不拥有独立 reply 语义。

无效 reference/selection 的错误明确说明：

```text
No action was taken. Do not substitute another Fleet session. Relist or ask the user.
```
