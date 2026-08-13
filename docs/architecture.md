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

`ctx.subagents` 与 `ctx.workflowEngine` 对 Fleet Definition 都是**可选依赖**。当前 Provider 机会式读取 `ctx.subagents` 只影响 Fleet 对 delegated Session 的控制分类和错误：

- 有缝：当前 Fleet API 仍延期 delegated 写入，后续 L2b 才能携带精确 parent authority 转到 subagent API；
- 无缝：推断为 child 的 Session 为 observe-only，写操作失败并说明缺少 subagent seam。

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

未来跨进程或多 runtime 支持不能只把 `list()` 改成分发扫描；它将需要新的 Provider、transport、runtime namespace、寻址和权限设计。本阶段不展开这些实现规格。

## 公开 seam（允许依赖）

| 能力 | 角色 |
|---|---|
| Cordis `Service` + declaration merge | Fleet Definition |
| `ctx.agents` | 当前 Provider 的 root 控制面 |
| `Agent.session` / inbox / header | 视图投影 |
| `createUserMessage` | `source.kind: 'plugin'` |
| `ctx.subagents`（可选） | delegated 控制分类；未来 child 写路径 |
| `ctx.workflowEngine`（未来 L3 可选组合） | 主管编排 |
| `ctx.tools` | `fleet_*` Consumer |
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
```

Provider 卸载后，任何保留的旧 Service 引用都以 `fleet-unavailable` 拒绝上述操作，不再读取 Agent 注册表或调用 Agent。

`subscribe` 的 listener 是观察者。同步异常和返回 Promise 的拒绝会逐个记录，并且不阻断 Agent 生命周期或其他 Fleet listener。

`opts` 带可选 `callerSessionId`。传入时禁止控制自己。

视图只含 JSON-safe 字段。`kind` 区分控制面，而不是把实现细节泄漏出去：

```text
kind: 'root' | 'delegated'
control: 'direct' | 'subagent' | 'observe-only'
```

- `root` + `direct`：当前 Provider 走 `Agent`
- `delegated` + `subagent`：写路径必须有 `ctx.subagents`
- `observe-only`：只读（one-shot、无 subagent seam、或策略关闭写入）

## `sessionId` 寻址

Fleet 所有路由操作以 `sessionId` 为主键。`fleet_list` 的 canonical output `{ agents, count }` 必须无损返回每个 `FleetAgentView.sessionId`，后续 inspect/send/steer/cancel 使用该值寻址。

`sessionId` 在当前 DSH runtime 范围内稳定。未来任何 Session-list UI 必须展示它并提供复制操作；当前包没有该 UI。若未来支持多个 runtime，必须另行增加 runtime namespace 或等价寻址机制，不能假定当前 `sessionId` 已是全局 remote address。

## 当前 Provider 行为

取消使用 `{ kind: 'hook', reason: 'fleet-cancel' }`。

发送/转向消息来源：

```ts
{ kind: 'plugin', plugin: 'dsh-supervisor' }
```

对象范围：

| 对象 | 当前行为 |
|---|---|
| live root | list / inspect / send / steer / cancel |
| 被当前元数据启发式推断为 delegated，且 `subagents` 已挂载 | list / inspect；写入返回 `fleet-delegated-write-deferred` |
| 被当前元数据启发式推断为 delegated，且无 `subagents` | 只读；写入返回 `fleet-observe-only` |
| cold Session | 不出现在 `list()` |
| 调用方自己的 Session | 拒绝控制 |

### 已知 runtime-root 分类缺口

目标不变量是以 `ctx.agents.roots()` 判断 authoritative runtime root membership。当前实现仍通过 `origin === 'subagent'` 或 `parentSession` 等 lineage 元数据推断 `root` / `delegated`；这不是最终权威分类，修复仍待完成。

在修复前，`kind`、`control`、`rootsOnly` 以及依赖该分类的 root 写授权或 delegated 写错误都可能受误分类影响。文档和产品声明不得把 child/root 分类描述为已完全正确。

## 组合

插件声明 `dsh.bundle.patch`。patch **只 insert 自己的 row**，不整行替换官方 bundle config。

当前调试宿主是现有 `web` profile。它不表示插件提供 remote Web 或 supervisor UI；独立 `supervisor` profile 属于未来 L4+。

Supervisor preset（未来 L3）只能：

- 在 agent 平面挂载 Fleet Consumer；
- 仅在 public workflow seam 和 workflow Consumer 都实际挂载时暴露 workflow tools；
- 仅在 public subagent seam 和 subagent Consumer 都实际挂载时暴露 subagent tools；
- 用 preset / `tools.restrict` 限制主管自己的执行工具；
- 让 Fleet Provider 留在 host 平面，保持同一 DSH runtime 的共享视图。

## 版本

Peer 对准 `@deepseek-ai/dsh@0.1.0-rc.6` 携带的公开包。Sibling 源码 checkout 只作只读参考，可能处于不同 release candidate。
