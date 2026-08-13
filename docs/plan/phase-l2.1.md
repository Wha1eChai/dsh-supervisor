# L2.1 — Authoritative runtime ownership

**状态：已交付。**

## 目标

收紧 Fleet 的 root/delegated 正确性，不改变 Fleet Service、工具 JSON schema、工具描述或 delegated 写能力。唯一分类规则是：

```text
kind === 'root'      ⇔ exact Agent object ∈ ctx.agents.roots()
kind === 'delegated' ⇔ exact Agent object ∉ ctx.agents.roots()
```

`session.header.origin` 与 `session.header.parentSession` 是 durable Session metadata，不参与 `kind`、`control`、`rootsOnly` 或写授权。`parentSession` 始终独立投影为 `parentSessionId`，所以 runtime root 可以带 lineage，runtime delegated Agent 也可以不带 lineage。

## 一致性不变量

同一个 exact live Agent 的 runtime kind 同时驱动：

| 行为 | root | delegated |
|---|---|---|
| `FleetAgentView.kind` | `root` | `delegated` |
| `rootsOnly` | 保留 | 排除 |
| `control` | `direct` | 有 `ctx.subagents` 时 `subagent`，否则 `observe-only` |
| `send` / `steer` / `cancel` | 直接调用 Agent | deferred 或 observe-only 错误 |
| created/status/disposed event | `root` | `delegated` |

Delegated 写能力不在本层实现：有 subagent seam 时返回 `fleet-delegated-write-deferred`，没有时返回 `fleet-observe-only`。Fleet 不调用 `ctx.subagents.followup()` / `interrupt()`，也不直接写 delegated Agent。

## 生命周期缓存

`InProcessFleetProvider` 用 `WeakMap<Agent, FleetAgentKind>` 按 exact Agent 对象缓存 runtime classification。

Provider 挂载顺序：

1. 注册全局 `agent/created`、`agent/status`、`agent/disposed` listener。
2. 各读取一次 `ctx.agents.list()` 与 `ctx.agents.roots()`。
3. 用 exact object identity seed 全部已 live Agent。
4. 不补发 synthetic Fleet `created` event。

Live Agent 的 created/status/list/inspect/write observation 都通过同一个 classifier 刷新缓存。批量 list 与 Provider 挂载时的 seed 各自只为整批 Agent 构造一个 root identity set。

`agent/disposed` 在 registry 删除后发出，因此 disposal 只读取 `runtimeKinds.get(disposedAgent)`。Provider 先用缓存 kind 构造完整旧 view，再删除 exact Agent key，最后通知 Fleet subscriber。该路径禁止读取 roots、按 session id 查询 replacement、调用 `isOwnedBy` 或回退到 lineage metadata。

按对象 identity 缓存使同 `sessionId` replacement 与旧 Agent 拥有独立 key。旧 disposal 不会误投影 replacement，也不会删除 replacement 的分类。

Provider unload 会停止操作并清空 subscriber 集合。保留的旧 Fleet reference 继续以 `fleet-unavailable` 失败，且不访问 AgentRegistry；`WeakMap` 不提供可枚举 retained state，Provider 生命周期结束后不保留可观察 Agent 列表。

## 验收

回归测试通过公开 AgentRegistry ownership API 创建 child：

```ts
const detach = ctx.agents.enter(child, owner)
ctx.agents.announce(child)
```

覆盖：

- 带 `origin: 'subagent'` 与 `parentSession` 的 ordinary registration 仍为 root/direct、包含于 rootsOnly，并可 send/steer/cancel；
- 只有 `origin: 'subagent'` 的 ordinary registration 同样为 root/direct 且可写；
- 没有 lineage metadata 的 owner-entered child 为 delegated；
- 有/无 subagent seam 时 control 与 delegated 写错误保持不变；
- root 与 delegated 的 created/status/disposed event kind 一致；
- registry 删除后的 disposal 保留旧 child kind；
- Provider 晚挂载时已 live root/child 分类正确且无 synthetic created event；
- 同 id replacement 的 created、list、inspect、writes 与后续 disposal 不受旧 disposal 影响；
- inspect 与全部写方法和 list 使用同一 runtime ownership。

## 不做

- 不改变 Fleet public type union 或工具 JSON schema；
- 不实现 delegated writes 或 parent authority API；
- 不修改工具描述、prompt、card 或 UI；
- 不新增 preset、transport、remote、cross-process 或 multi-runtime 功能；
- 不拆分 FleetControl。
