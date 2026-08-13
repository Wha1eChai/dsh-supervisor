# L1 — Fleet 能力缝

**状态：已完成，runtime-root 分类仍有待修正确性项。**

## 目标

在同一运行中 DSH runtime（一个 `dsh` 进程）内提供 `ctx.fleet`。Provider 投影该 runtime 的 live Agent，并对被分类为 **root** 的目标执行 send / steer / cancel。Service API 只暴露 JSON-safe 数据，使后续 Consumer 只依赖 `ctx.fleet`。

## 模块划分

建议（可同包，逻辑上分开）：

| 模块 | 角色 |
|---|---|
| `src/types.ts` | JSON-safe 视图、错误、事件 |
| `src/service.ts` | `FleetService` Definition：校验、权限、委托到当前 Provider |
| `src/providers/in-process.ts` | 当前同进程 Provider：读 `ctx.agents`，写 root 的 `Agent` |
| `src/classify.ts` | 当前 root vs delegated lineage 启发式（`session.header.origin` / `parentSession`） |
| `src/index.ts` | 挂载 Service + 当前同进程 Provider |
| `tests/*.spec.ts` | mock Agent 注册表 |

L1 可以暂不拆 npm 子包。拆包是缝稳定之后的事。

## Service 契约

```ts
interface FleetListFilter {
  rootsOnly?: boolean
  runningOnly?: boolean
}

interface FleetInspectOptions {
  tailMessages?: number // omitted => config.defaultTailMessages; clamped to config.maxTailMessages
}

interface FleetCallerOptions {
  callerSessionId?: string
}

interface FleetService {
  list(filter?: FleetListFilter): FleetAgentView[]
  inspect(sessionId: string, opts?: FleetInspectOptions): FleetInspectView
  send(sessionId: string, text: string, opts?: FleetCallerOptions): { messageId: string }
  steer(sessionId: string, text: string, opts?: FleetCallerOptions): { messageId: string }
  cancel(sessionId: string, opts?: FleetCallerOptions & { keepInbox?: boolean }): { accepted: true }
  subscribe(listener: (event: FleetEvent) => void | Promise<void>): () => void
}
```

Provider 卸载后，保留的旧 Service 引用对全部公开操作抛 `fleet-unavailable`，且不得再读取 Agent 注册表或调用 Agent。

Fleet listener 只观察投影事件。listener 同步异常或返回 Promise 的拒绝必须记录，并继续通知其余 listener，不得否决 Agent 生命周期。

`FleetAgentView` 至少包含：

```text
sessionId
status            // 'idle' | 'running'
kind              // 'root' | 'delegated'
control           // 'direct' | 'subagent' | 'observe-only'
parentSessionId?
cwd?
blank?
queueCount
updatedAt?
```

`inspect` 在 view 之上加尾部文本摘要（从 `session.deriveMessages()` 取 user/assistant 文本，按配置截断）。禁止返回 `Agent` / `Session` / 全量 event 数组。

`sessionId` 是当前 DSH runtime 内稳定的 Fleet 路由标识。`list()` 的每个 view 都必须保留它，后续 inspect/send/steer/cancel 使用它寻址；它不是全局或跨 runtime remote address。

## 插件配置

遵守官方“deployment-varying values 不得硬编码”规则。入口同时导出 Schemastery `Config`：

```ts
interface Config {
  defaultTailMessages: number
  maxTailMessages: number
  maxMessageTextChars: number
}
```

建议默认值为 `8`、`32`、`2000`；这些只是 schema 默认值，不是写死在 Provider 方法里的常量。schema 必须要求整数、正数，并保证 `defaultTailMessages <= maxTailMessages`；若 Schemastery 不能表达字段间关系，在插件加载时立即抛出可操作错误。

## 错误（稳定字符串，测试钉死）

| 条件 | 建议 message 子串或 code |
|---|---|
| Provider 已卸载 | `fleet-unavailable` |
| 未知 id | `fleet-not-found` |
| 控制自己 | `fleet-self-target` |
| child 写入且 L1 未接 subagent | `fleet-delegated-write-deferred` |
| child 且无 `ctx.subagents` | `fleet-observe-only` |
| 空文本 | `fleet-empty-text` |

用带 `code` 字段的 Error 子类，便于工具以后映射，而不解析英文句子。

## 当前 Provider

- `list`：`ctx.agents.list()`，映射同一 DSH runtime 的 live Agent 视图。
- 当前分类启发式：`header.origin === 'subagent'` 或存在 `header.parentSession` → `delegated`。
- delegated + `ctx.get('subagents')` 存在 → `control: 'subagent'`，L1 写入仍抛 `fleet-delegated-write-deferred`。
- delegated + 无 subagents → `control: 'observe-only'`，写入抛 `fleet-observe-only`。
- root → `control: 'direct'`，`send`=`followup`，`steer`=`steer`，`cancel`=`cancel({ kind: 'hook', reason: 'fleet-cancel' }, { keepInbox })`。
- 消息：`createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-supervisor' } })`。
- `subscribe`：监听 `agent/created`、`agent/status`、`agent/disposed`（以及需要时的 `session/event` 仅用于更新摘要，注意不要把全量 token 转发出去）。监听必须挂在 `ctx.effect` / `ctx.on` 上，卸载即摘掉；Fleet listener 失败只记录，不向权威 Agent 事件传播。

`blank`：无 `turn/start` 则为 true（与官方 list 语义对齐的简化版即可，测试钉死）。

`queueCount`：`inbox.nextTurn.length + inbox.nextStep.length`。

### 已知 runtime-root 分类缺口

目标权威来源是 `ctx.agents.roots()`。当前 `origin` / `parentSession` 仅是 lineage 元数据启发式，可能误分类 runtime root；修复仍待完成。因此 `kind`、`control`、`rootsOnly`、root 写授权和 delegated 写错误不能被描述为对所有 Agent 都已正确。

## 测试套件（L1 门禁）

全部 keyless，mock `Agent` / `AgentRegistry` / 可选的 `subagents`。

必测：

1. `list` 返回两个 live root，字段完整。
2. `runningOnly` / `rootsOnly` 过滤。
3. 带当前 lineage 标记的 child 按现有启发式投影为 `kind: 'delegated'`；该测试不证明 authoritative runtime-root 分类已经正确。
4. 有假 `subagents` 时 child 的 `control === 'subagent'`，`send` 抛 `fleet-delegated-write-deferred`。
5. 无 `subagents` 时 child 的 `control === 'observe-only'`，`send` 抛 `fleet-observe-only`。
6. `send` / `steer` 调用了对应 Agent 方法，且 message source 为 plugin `dsh-supervisor`。
7. `cancel` 使用 `hook` / `fleet-cancel`；`keepInbox` 传到 Agent。
8. `callerSessionId === target` 时 send/steer/cancel 抛 `fleet-self-target`。
9. 未知 id 抛 `fleet-not-found`。
10. 空文本抛 `fleet-empty-text`。
11. `inspect` 按测试配置的 `defaultTailMessages` 返回默认尾部消息；超过 `maxTailMessages` 被夹紧，并按 `maxMessageTextChars` 截断。
12. `subscribe` 在 status 变化时收到事件；disposer / 插件 unload 后不再收到。
13. 保留卸载前的 Service 引用时，所有公开操作抛 `fleet-unavailable`，且 Agent 注册表和 Agent 方法均无调用。
14. 首个 Fleet listener 在 created/status 上抛错或拒绝时，Agent 生命周期继续，后续 listener 仍收到事件，错误被记录。

不测：真实 LLM、真实 `dsh web`、Electron、dispose Agent。

## 验收

- `pnpm test` 与 `pnpm typecheck` 通过。
- 手工（可选，非门禁）：隔离 `DSH_HOME` 安装后 `--dump-config` 仍含本层；Web 里开两个 Session 时，若已暴露临时 debug 则 `list` 长度为 2。L1 可以只靠单测关门。

## 不做

- `fleet_*` 工具注册（L2）
- `ctx.subagents.followup` / `interrupt` 精确 parent authority 转发（L2b）
- preset / workflow / transport / Electron
- 改官方仓库
