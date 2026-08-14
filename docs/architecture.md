# 架构

本插件按 DSH 的 capability-seam 哲学挂进用户正在运行的 `dsh` 进程：Definition 稳定，Provider 可替换，Consumer 只看见 JSON-safe 的 `ctx.fleet`。当前架构范围仅覆盖同一 DSH runtime 内的 live Session 通信。

## 哲学约束

DSH 里“热插拔”不是口号，而是强制结构：

1. **缝是完整能力，不是一个角色。** `ctx.fleet` 必须同时有 Definition、至少一个 Provider、以及独立的 Consumer。工具直接 `inject: ['agents']` 再 `followup`，会把实现焊死在当前 Agent 注册表上。
2. **已有缝优先于新词汇。** 子 Agent 的生命周期、继续写入、中断、枚举已经由 `ctx.subagents` 拥有。编排脚本和扇出已经由 `ctx.workflowEngine` 拥有。Fleet 只补跨 root Session 的观察与有限控制，不复制那两条缝。
3. **Scope 是注册寿命，Lineage 是数据。** 子 Agent 不继承父级 scope 注册。Fleet 工具若要只给主管用，应挂在 supervisor preset 的 `agent.ctx` 上，或用 `tools.restrict`，而不是在 Service 里按“是不是子 Agent”偷偷改全局工具表。
4. **所有权跟官方一致。** 和 `SubagentRun` / `WorkflowRun` 一样：未发布的工作由 Provider 回滚；已交给调用方的操作按公开约定结算。Fleet **不**持有 `AgentHandle.dispose`。

## 三条缝如何分工

```text
ctx.agents              单个 live Agent 的 inbox / followup / steer / cancel
ctx.sessions            事件日志与 fork
ctx.subagents           具名 Provider 上的委托：start / followup / interrupt / listChildren
ctx.workflowEngine      模型脚本编排；子调用走 subagents
ctx.fleet               本仓库：同一 runtime 的跨 Session Fleet 视图 + 对 root 的有限控制
```

| 对象 | 谁拥有操作 |
|---|---|
| live root Agent | `ctx.fleet` 当前 Provider 调 `Agent.followup` / `steer` / `cancel` |
| session-backed child | `ctx.subagents.followup` / `interrupt` / `listChildren`（缝存在时） |
| 主管扇出多个检查/派发 | `ctx.workflowEngine` 及其 Consumer（未来 L3 组合） |
| 跨进程或多 runtime | 当前未实现；需要新的 Provider、transport、身份命名和权限设计 |

`ctx.subagents` 与 `ctx.workflowEngine` 对 Fleet Definition 都是**可选依赖**。当前 Provider 机会式读取 `ctx.subagents` 只影响 Fleet 对 runtime delegated Agent 的控制分类和错误：

- 有缝：当前 Fleet API 仍延期 delegated 写入，后续 L2b 才能携带精确 parent authority 转到 subagent API；
- 无缝：runtime delegated Agent 为 observe-only，写操作失败并说明缺少 subagent seam。

Service 存在不代表对应模型工具已经挂载。不要为了“方便”在无 `subagents` 时对 child 调 `Agent.followup()`；那会绕过 continuable Activation、父权威和 cold resume。

## 工具发现与能力暴露

模型可见工具由当前 profile/registry 组合决定：

1. Fleet tool Consumer 只通过 `ctx.tools.register(...)` 注册当前 `controlMode` 允许的 `fleet_*`。
2. System prompt/tool assembly 会在每次模型请求前读取当前 tool registry，因此已经 live 的 Session 无需重建；Consumer 挂载或重配后，它在下一次模型请求中自然看到最新工具集合。
3. 工具 schema 通过模型请求的 tools 字段提供。Fleet 不生成用于能力通知的 Session/chat event，也不增加只为广告工具存在而常驻的 system prompt prose。
4. Subagent 工具必须由对应 public seam 和官方 Consumer 注册；workflow 工具同理。
5. 未来 supervisor preset 只能条件组合实际存在的 seam 和已挂载 Consumer，不复制工具实现、schema 或描述不可用能力。

因此，Provider 内 `ctx.get('subagents')` 的机会式读取不会自动暴露 subagent 工具，Fleet 也完全不以 `ctx.workflowEngine` 的存在作为工具广告信号。

## 进程位置与当前范围

```text
dsh --profile <name>
  └─ official bundles
       └─ @wha1echai/dsh-supervisor
            ├─ FleetService          Definition + 当前进程内 Provider
            ├─ fleet_* tools         Consumer（L2）
            ├─ future: supervisor preset
            ├─ future: first-class surfaces
            └─ future: transports / other providers
```

`ctx.agents` 的 live 状态是**当前 DSH runtime 内**的。一个 Fleet Provider 实例只看见它所在的 `dsh` 进程。当前没有跨进程、跨终端或跨设备、本地到服务器、remote Web、gateway、stdio、daemon 或多 runtime 聚合实现。

Fleet 可机会式读取可选的 `ctx.sessionTitle`，以 exact `agent.session` 调用 `get()` 读取日志中已有的 `session/title`。这不是新的 capability seam，也不是 Provider hard dependency；服务缺失或卸载时，Fleet 继续提供 live discovery 和 inspect，只省略 `title`。Fleet 不调用标题生成、刷新、Provider 注册或 LLM。标题只属于 JSON-safe 展示投影，不影响 identity、routing、selection、排序、过滤或授权。

未来跨进程或多 runtime 支持不能只把 `list()` 改成分发扫描；它将需要新的 Provider、transport、runtime namespace、寻址和权限设计。本阶段不展开这些实现规格。

## 公开 seam（允许依赖）

| 能力 | 角色 |
|---|---|
| Cordis `Service` + declaration merge | Fleet Definition |
| `ctx.agents` | live Agent、runtime ownership 分类与 root 控制面 |
| `Agent.session` / inbox / header | 视图投影 |
| `createUserMessage` | direct `plugin` source and selected `fleet-relay` source |
| `ctx.subagents`（可选） | delegated 控制分类；未来 child 写路径 |
| `ctx.workflowEngine`（未来 L3 可选组合） | 主管编排 |
| `ctx.tools` | `fleet_*` Consumer |
| optional `ctx.sessionTitle` | 已记录标题的展示投影；不改变 Fleet capability seam |
| `dsh.bundle` + profile | 安装 |

禁止：

- 官方未导出内部模块
- 直接 import 某个 subagent Provider 实现（`spawn` / `fork` / `acp`）
- 复制 `dsh-web-app` 的 Client 树来“接管 UI”
- 在工具里写死 `ctx.agents.get(id).followup(...)`
- Fleet Consumer 复制或广告 subagent/workflow 工具

## Fleet 词汇（Definition 拥有）

Service key：`fleet`。

当前操作：

```text
list(filter?) -> FleetAgentView[]
inspect(sessionId, opts?) -> FleetInspectView
send(sessionId, text, opts) -> { messageId }
steer(sessionId, text, opts) -> { messageId }
cancel(sessionId, opts?) -> { accepted: true }
subscribe(listener) -> disposer

listTargets(options) -> FleetTargetView[]
inspectTarget(targetRef, options) -> FleetTargetInspectView
sendSelected(selectionHandle, text, options) -> { sessionId, messageId, deliveryId, replyReceipt, replyReceiptExpiresAt }
waitForReply(replyReceipt, options) -> FleetReplyResult
steerSelected(selectionHandle, text, options) -> { sessionId, messageId, deliveryId }
cancelSelected(selectionHandle, options) -> { sessionId, accepted: true }
```

Provider 卸载后，任何保留的旧 Service 引用都以 `fleet-unavailable` 拒绝上述操作，不再读取 Agent 注册表或调用 Agent，并清空所有 target reference、selection 与 reply record；active reply waiter 同样失败。

`subscribe` 的 listener 是观察者。同步异常和返回 Promise 的拒绝会逐个记录，并且不阻断 Agent 生命周期或其他 Fleet listener。

`opts` 带可选 `callerSessionId`。传入时禁止控制自己。

视图只含 JSON-safe 字段。`kind` 来自 AgentRegistry runtime ownership，而不是 durable Session lineage：

```text
kind: 'root' | 'delegated'
control: 'direct' | 'subagent' | 'observe-only'
```

- exact Agent 属于 `ctx.agents.roots()` → `root` + `direct`，当前 Provider 直接走 `Agent`
- exact Agent 不属于 `ctx.agents.roots()` → `delegated`；有 `ctx.subagents` 时为 `subagent`，否则为 `observe-only`

`session.header.origin` 和 `session.header.parentSession` 不参与 `kind`、`control`、`rootsOnly` 或写授权。`parentSession` 仍独立投影为 `parentSessionId`，所以 runtime root 可以带 `parentSessionId`，runtime delegated Agent 也可以不带该字段。

## 寻址与模型目标确认

`sessionId` 仍是当前 runtime 内的 canonical routing identifier，direct Service API 继续使用它。模型工具不再跨调用提交 `sessionId`：`fleet_list` 为 owning caller 签发 `targetRef`，`fleet_inspect` 用它确认 exact target 并按当前写策略签发 `selectionHandle`，写工具只接受 selection。

两类 handle 都只存在于 Provider 内部，并绑定 exact caller Agent、exact target Agent、Provider instance 和 expiry。Confirmed-target Service options 必须携带 ToolRuntime 提供的 exact caller Agent；`callerSessionId` 只是与该对象的交叉校验。使用时再次核对 registry 的 exact-object identity；caller/target replacement、disposal、expiry、unload 或 mismatch 都失效。Selection 在 Agent 副作用前 single-attempt 消费。

`sessionId` 在当前 DSH runtime 范围内稳定。未来任何 Session-list UI 必须展示它并提供复制操作；当前包没有该 UI。若未来支持多个 runtime，必须另行增加 runtime namespace 或等价寻址机制，不能假定当前 `sessionId` 已是全局 remote address。

## Reply observation 与 Jobs 分工

Selected follow-up 在 target side effect 前建立 caller-bound、exact-target-bound reply record。Provider 只用 `agent/inbox/claimed` 将 exact message 绑定到 turn，再从 exact target Session 的 `assistant/message` 与 `turn/end` 生成 bounded turn-level result。它不使用 `agent/status`、`whenIdle()` 或轮询，不声称 assistant output 只由该 message 因果产生，并且不把 steer 解释成独立 reply turn。

`@wha1echai/dsh-supervisor/reply-job` 是独立 Consumer：只在 `ctx.jobs` 存在时注册 `fleet_wait` 并生产 `fleet-reply` job。它不注册 job list/output/kill，不 attach controller，不发送 completion notice；这些职责留给官方 Jobs Consumer。该入口必须挂在 intended Agent 的 host/preset composition 中，并与官方 Jobs Consumer 的 scope 对齐；ToolRuntime 按注册 context 的 scope 只向该 composition 及其后代暴露工具。

## 当前 Provider 行为

取消使用 `{ kind: 'hook', reason: 'fleet-cancel' }`。

Direct 发送/转向消息来源：

```ts
{ kind: 'plugin', plugin: 'dsh-supervisor' }
```

Confirmed-target selected `send` / `steer` 使用 versioned `fleet-relay` source。`senderSessionId` 只能来自 selection 绑定的 exact caller Agent，`deliveryId` 由 Provider 生成并用于 receipt correlation。模型可见 header 同时编码 sender 和 delivery id；固定 marker 之后的 body 从独立 text block 开始并保持 untrusted。正文不是授权或 correlation 来源。Relay source 已包含在现有 durable `user/message` 中，不新增 Fleet Session event。`target_ref` / `selection_handle` 不出现在 relay source、body、receipt 或 inspect projection 中，也不进入 transient Provider relay state；正常 DSH tool/call audit 仍保留工具 arguments。

对象范围：

| 对象 | 当前行为 |
|---|---|
| exact live Agent 属于 `ctx.agents.roots()` | list / inspect / send / steer / cancel；`kind: root`、`control: direct` |
| exact live Agent 不属于 roots，且 `subagents` 已挂载 | list / inspect；`kind: delegated`、`control: subagent`；写入返回 `fleet-delegated-write-deferred` |
| exact live Agent 不属于 roots，且无 `subagents` | list / inspect；`kind: delegated`、`control: observe-only`；写入返回 `fleet-observe-only` |
| cold Session | 不出现在 `list()` |
| 调用方自己的 Session | 拒绝控制 |

Provider 为 exact Agent 对象缓存已观察到的 runtime classification，并在 disposal 时撤销该对象作为 caller 或 target 的所有 confirmed-target state。挂载时先注册生命周期监听器，再用一次 `list()` 与一次 `roots()` seed 已经 live 的 Agent。`created`、`status`、`list`、`inspect` 和写授权都会刷新同一对象缓存；`disposed` 在 registry 删除后只读取该 exact Agent 的缓存，不按 `sessionId` 查 replacement，也不重新查询 roots。因此 disposal event 保留旧 Agent 的 runtime kind，同 id replacement 的分类不会被旧 lifecycle 覆盖或删除。

## 组合

插件声明 `dsh.bundle.patch`。patch **只 insert repository-owned rows**，不整行替换官方 bundle config。Bundle 插入 host-plane Provider 与安全 `read-only` 核心 Consumer；可选 `./reply-job` 不由 Bundle 全局插入，部署者把它加入需要 `fleet_wait` 的 host/preset composition。

当前调试宿主是现有 `web` profile。它不表示插件提供 remote Web 或 supervisor UI；独立 `supervisor` profile 属于未来 L4+。

Supervisor preset（未来 L3）只能：

- 在 agent 平面挂载 Fleet Consumer；
- 仅在 public workflow seam 和 workflow Consumer 都实际挂载时暴露 workflow tools；
- 仅在 public subagent seam 和 subagent Consumer 都实际挂载时暴露 subagent tools；
- 用 preset / `tools.restrict` 限制主管自己的执行工具；
- 让 Fleet Provider 留在 host 平面，保持同一 DSH runtime 的共享视图。

## 版本

Peer 对准 `@deepseek-ai/dsh@0.1.0-rc.6` 携带的公开包。Sibling 源码 checkout 只作只读参考，可能处于不同 release candidate。
