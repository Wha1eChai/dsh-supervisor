# 分层全景

当前已交付范围是 L0–L2，产品优先级是同一运行中 DSH runtime（一个 `dsh` 进程）内 live Session 之间的通信。L2b 和 L3–L6 都是未来工作，不构成当前支持声明。

```text
L0  仓库骨架 + 可安装 bundle                       已交付
L1  ctx.fleet Definition + 当前进程内 Provider + 单测 已交付
L2  fleet_* 模型工具（Consumer）                    已交付
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

## L1 — Fleet seam（已交付，含待修正确性项）

`ctx.fleet` 可 `list` / `inspect` / `send` / `steer` / `cancel` / `subscribe`。当前 Provider 投影同一 DSH runtime 的 live Agent，单元测试覆盖现有权限、分类投影和消息来源。

当前已有 root/delegated 投影，但仍以 `origin` / `parentSession` lineage 元数据推断。以 `ctx.agents.roots()` 作为 authoritative runtime-root classifier 是下一项 correctness priority，尚未完成；因此不能把当前 child/root 分类描述为完全正确。`kind`、`control`、`rootsOnly`、root 写授权和 delegated 写错误都可能受该缺口影响。

详见 [phase-l1.md](phase-l1.md)。

## L2 — 模型工具（已交付）

`@wha1echai/dsh-supervisor/tool` 只注入 `fleet` 和 `tools`，按 `read-only` / `message` / `full` 安全模式注册 `fleet_list` / `fleet_inspect` / `fleet_send` / `fleet_steer` / `fleet_cancel`。模型不能提供 caller id；写工具从 owning Agent 派生，并继续由 Fleet 拒绝 self/delegated 写入。

Consumer 挂载控制模型可见性。已经 live 的 Session 会在下一次模型请求中通过正常 ToolRuntime 组合看到当前工具集合；不注入聊天消息，也不添加只用于能力广告的常驻 prompt prose。`fleet_list` 返回 `{ agents, count }`，每个 Agent 视图中的 `sessionId` 是后续 Fleet 操作的当前 runtime 路由标识。

详见 [phase-l2.md](phase-l2.md)。Delegated followup / interrupt 需要精确 parent authority，单列后续 L2b，不从 Consumer 绕过 Service Definition。

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
