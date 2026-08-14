# 分层全景

当前已交付范围是 L0–L2.3，产品优先级是同一运行中 DSH runtime（一个 `dsh` 进程）内 live Session 之间的通信。L2b 和 L3–L6 都是未来工作，不构成当前支持声明。

```text
L0  仓库骨架 + 可安装 bundle                       已交付
L1  ctx.fleet Definition + 当前进程内 Provider + 单测 已交付
L2  fleet_* 模型工具（Consumer）                    已交付
L2.1 AgentRegistry runtime ownership 正确性修复      已交付
L2.2 caller-bound confirmed target writes            已交付
L2.3 title-rich discovery + inspect truncation        已交付
L2b delegated Session 写路径                         未来
L3  supervisor Agent preset（条件组合可选能力）       未来
L4  独立 profile / first-class surface / transport   未来
L5  可选 Electron wrapper                            未来
L6  daemon / 多 runtime Provider / 权限深化           未来
```

依赖只能向下：L2 只打 `ctx.fleet`，不打 `ctx.agents`。未来产品面只打公开 Consumer 或 transport，不内嵌 Agent 循环。

## L0 — 骨架（已交付）

独立仓库能被 `dsh plugin --profile web add` 装进官方 npm `dsh@0.1.0-rc.6`。`dsh --profile web --dump-config` 能看到本 Bundle 层。这里的 `web` profile 只是现有宿主，不表示插件提供 remote Web 或 supervisor UI。

详见 [phase-l0.md](phase-l0.md)。

## L1 — Fleet seam（已交付）

`ctx.fleet` 可 `list` / `inspect` / `send` / `steer` / `cancel` / `subscribe`。当前 Provider 投影同一 DSH runtime 的 live Agent，单元测试覆盖权限、消息来源、transcript 投影和生命周期隔离。

详见 [phase-l1.md](phase-l1.md)。

## L2 — 模型工具（已交付）

`@wha1echai/dsh-supervisor/tool` 只注入 `fleet` 和 `tools`，按 `read-only` / `message` / `full` 安全模式注册 `fleet_list` / `fleet_inspect` / `fleet_send` / `fleet_steer` / `fleet_cancel`。模型不能提供 caller id；写工具从 owning Agent 派生，并继续由 Fleet 拒绝 self/delegated 写入。

Consumer 挂载控制模型可见性。已经 live 的 Session 会在下一次模型请求中通过正常 ToolRuntime 组合看到当前工具集合；不注入聊天消息，也不添加只用于能力广告的常驻 prompt prose。

详见 [phase-l2.md](phase-l2.md)。Delegated followup / interrupt 需要精确 parent authority，单列后续 L2b，不从 Consumer 绕过 Service Definition。

## L2.1 — Authoritative runtime ownership（已交付）

Fleet 通过 exact Agent 是否属于 `ctx.agents.roots()` 权威分类 `root` / `delegated`。Durable `origin` 与 `parentSession` 只作为 Session metadata；`parentSession` 仍独立投影为 `parentSessionId`。list、inspect、rootsOnly、root 写授权和 created/status/disposed event 共用该分类。

Provider 使用 exact Agent 对象的 `WeakMap` 缓存，挂载时 seed 已经 live 的 Agent，并在 registry 删除后的 disposal event 中保留旧分类。同 `sessionId` replacement 不会被 stale disposal 误分类或清理。

详见 [phase-l2.1.md](phase-l2.1.md)。

## L2.2 — Confirmed target writes（已交付）

可信程序化 Consumer 继续使用 direct `sessionId` Service API；模型工具改为 `fleet_list -> target_ref -> fleet_inspect -> selection_handle -> write`。Handle 同时绑定 exact caller Agent、exact target Agent、Provider instance 和 expiry，selection 在 Agent 副作用前 single-attempt 消费。

无效、过期、caller mismatch、disposal、同 ID replacement、unload 或重复使用都 fail closed，不会回退到其他 Session。Self/delegated target 可 inspect，但不签发 selection。

详见 [phase-l2.2.md](phase-l2.2.md)。

## L2.3 — Title-rich discovery and inspect fidelity（已交付）

Fleet 只读地读取可选 `ctx.sessionTitle` 对 exact live `Session` 的已记录 `session/title`，在服务缺失或卸载时继续提供 live discovery 与 inspect。标题仅为 JSON-safe 展示字段，不参与 identity、routing、selection、排序、过滤或授权，也不触发 refresh、generation、Provider 或 LLM。

Inspect 将符合条件的 user/assistant 消息先过滤，再分别报告 `omittedMessages` 与每条摘要的 `textTruncated`，不把 tool、reasoning 或其他消息角色计入 omission。

详见 [phase-l2.3.md](phase-l2.3.md)。

## L3 — Preset（未来）

`supervisor` preset 只能组合实际挂载的 public capability：

- Fleet 工具只由 Fleet Consumer 暴露；
- subagent 工具只在 public subagent seam 和官方 Consumer 都已挂载时暴露；
- workflow 工具只在 public workflow seam 和官方 Consumer 都已挂载时暴露；
- preset 不复制工具实现、schema 或 prompt 宣传不存在的能力。

Fleet Provider 仍留在 host 平面。主管自己的 bash/fs 等执行能力由未来 preset 明确限制。

## L4 — Profile、产品面与 transport（未来）

未来可以评估独立 `supervisor` profile、first-class Web surface 或 transport，但当前没有 cross-process、cross-terminal/device、local-to-server、remote Web、gateway 或 stdio 实现。任何 transport 都需要单独的身份、寻址和权限设计，本层不预先锁定实现规格。

## L5 — 可选桌面 wrapper（未来）

Electron 可以作为未来受支持产品面的可选 wrapper，不是当前优先级，也不是当前交付。任何 Session-list UI 必须显示并提供复制 `sessionId` 的操作；当前没有该 UI。

## L6 — 多 runtime 产品化（未来）

Daemon 和多 runtime 聚合都未实现，也不属于当前支持。若推进，需要新的 Fleet Provider、runtime namespace、transport 和权限设计；当前 `sessionId` 不得直接当作全局远程地址。
