# 架构

本插件按 DSH 的 capability-seam 哲学挂进用户的 `dsh` 进程：Definition 稳定，Provider 可替换，Consumer 只看见 JSON-safe 的 `ctx.fleet`。

## 哲学约束

DSH 里“热插拔”不是口号，而是强制结构：

1. **缝是完整能力，不是一个角色。** `ctx.fleet` 必须同时有 Definition、至少一个 Provider、以及独立的 Consumer。工具直接 `inject: ['agents']` 再 `followup`，等于把实现焊死，官方一换委托路径我们就废。
2. **已有缝优先于新词汇。** 子 Agent 的生命周期、继续写入、中断、枚举已经由 `ctx.subagents` 拥有。编排脚本和扇出已经由 `ctx.workflowEngine` 拥有。Fleet 只补“跨 root Session 的观察与有限控制”，不复制那两条缝。
3. **Scope 是注册寿命，Lineage 是数据。** 子 Agent 不继承父级 scope 注册。Fleet 工具若要只给主管用，应挂在 supervisor preset 的 `agent.ctx` 上，或用 `tools.restrict`，而不是在 Service 里按“是不是子 Agent”偷偷改全局工具表。
4. **所有权跟官方一致。** 和 `SubagentRun` / `WorkflowRun` 一样：未发布的工作由 Provider 回滚；已交给调用方的操作按公开契约结算。Fleet **不**持有 `AgentHandle.dispose`。

## 三条缝如何分工

```text
ctx.agents              单个 live Agent 的 inbox / followup / steer / cancel
ctx.sessions            事件日志与 fork
ctx.subagents           具名 Provider 上的委托：start / followup / interrupt / listChildren
ctx.workflowEngine      模型脚本编排；子调用走 subagents
ctx.fleet               本仓库：跨 Session 舰队视图 + 对 root 的有限控制
```

| 对象 | 谁拥有操作 |
|---|---|
| live root Agent | `ctx.fleet` 默认 Provider 调 `Agent.followup` / `steer` / `cancel` |
| session-backed child | `ctx.subagents.followup` / `interrupt` / `listChildren`（缝存在时） |
| 主管扇出多个检查/派发 | `ctx.workflowEngine`（L3+），脚本里再调 fleet / subagent 工具 |
| 换传输（本进程 → stdio → 多 Runtime） | 换 Fleet Provider，不改工具 |

`ctx.subagents` 与 `ctx.workflowEngine` 对 Fleet Definition 都是**可选依赖**。默认 Provider 用 `ctx.get('subagents')`：

- 有缝：child 标为 `delegated` / `subagent`；L1 明确延期写入，L2 才转到 subagent API；
- 无缝：child 标为 `observe-only`，写操作失败并说明缺少 subagent 缝。

不要为了“方便”在无 `subagents` 时对 child 调 `Agent.followup()`。那会绕过 continuable 的 Activation、父权威和 cold resume。

## 进程位置

```text
dsh --profile <name>
  └─ official bundles
       └─ @wha1echai/dsh-supervisor
            ├─ FleetService          Definition + 默认 Provider
            ├─ later: fleet_* tools  Consumer（L2）
            ├─ later: other providers
            ├─ later: supervisor preset
            └─ later: transport consumer
```

`ctx.agents` 的 live 状态是**进程内**的。一个 Fleet Provider 实例只看见它所在 `dsh` 进程。跨进程聚合是另一个 Provider，不是把 `list()` 写成分发扫描。

## 公开 seam（允许依赖）

| 能力 | 角色 |
|---|---|
| Cordis `Service` + declaration merge | Fleet Definition |
| `ctx.agents` | 默认 Provider 的 root 控制面 |
| `Agent.session` / inbox / header | 视图投影 |
| `createUserMessage` | `source.kind: 'plugin'` |
| `ctx.subagents`（可选） | child 写路径 |
| `ctx.workflowEngine`（可选，L3+） | 主管编排 |
| `ctx.tools` | fleet_* Consumer |
| `dsh.bundle` + profile | 安装 |

禁止：

- 官方未导出内部模块
- 直接 import 某个 subagent Provider 实现（`spawn` / `fork` / `acp`）
- 复制 `dsh-web-app` 的 Client 树来“接管 UI”
- 在工具里写死 `ctx.agents.get(id).followup(...)`

## Fleet 词汇（Definition 拥有）

Service key：`fleet`。

最小操作（L1）：

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

- `root` + `direct`：默认 Provider 走 `Agent`
- `delegated` + `subagent`：写路径必须有 `ctx.subagents`
- `observe-only`：只读（one-shot、无 subagent 缝、或策略关闭写入）

## 默认 Provider 行为

取消使用 `{ kind: 'hook', reason: 'fleet-cancel' }`。

发送/转向消息来源：

```ts
{ kind: 'plugin', plugin: 'dsh-supervisor' }
```

对象范围（L1）：

| 对象 | 行为 |
|---|---|
| live root | list / inspect / send / steer / cancel |
| live child 且 `subagents` 已挂载 | list / inspect；send/cancel 映射到 `followup` / `interrupt`（L1 可先拒绝写入并文档化，但分类必须已是 `delegated`） |
| live child 且无 `subagents` | 只读 |
| cold Session | 不出现在 `list()` |
| 调用方自己的 Session | 拒绝控制 |

L1 **先把 child 标对，写入返回 `fleet-delegated-write-deferred`**，直到 L2 接上 `subagents.followup` / `interrupt`。

## 组合

插件声明 `dsh.bundle.patch`。patch **只 insert 自己的 row**，不整行替换官方 bundle config。

第一阶段调试宿主是现有 `web` profile。独立 `supervisor` profile 属于 L4。

Supervisor preset（L3）应：

- 在 agent 平面挂载 fleet_* Consumer
- 需要扇出时挂载 workflow Consumer，并配置 `subagentProvider`
- 用 preset / `tools.restrict` 限制主管自己的执行工具
- 不把 Fleet Provider 放进 preset isolate realm（和官方把 `subagents` 留在 host 平面同一理由：跨 Session 查询必须是进程单例）

## 版本

peer 对准 `@deepseek-ai/dsh@0.1.0-rc.6` 携带的公开包。源码 checkout 的 `0.1.0-rc.5` 只作阅读参考。
