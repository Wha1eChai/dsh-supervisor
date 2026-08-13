# 分层全景

```text
L0  仓库骨架 + 可安装 bundle
L1  ctx.fleet Definition + 默认进程内 Provider + 单测
L2  fleet_* 模型工具（Consumer）
L3  supervisor agent preset（可选挂 workflow）
L4  独立 profile + 本地传输（stdio）
L5  Electron 壳（调起 dsh）
L6  daemon / 多 Runtime Provider / 权限深化
```

依赖只能向下：L2 只打 `ctx.fleet`，不打 `ctx.agents`。L5 只打传输 Consumer，不内嵌 Agent 循环。

## L0 — 骨架

独立仓库能被 `dsh plugin --profile web add` 装进官方 npm `dsh@0.1.0-rc.6`。`dsh --profile web --dump-config` 能看到本 bundle 层。启动不炸。

详见 [phase-l0.md](phase-l0.md)。

## L1 — Fleet 缝

`ctx.fleet` 可 `list` / `inspect` / `send` / `steer` / `cancel` / `subscribe`。默认 Provider 投影 live Agent。child 分类正确，写入按 [decisions.md](decisions.md) 拒绝或延期。单元测试覆盖权限、分类和消息来源。

详见 [phase-l1.md](phase-l1.md)。

## L2 — 模型工具

`fleet_list` / `fleet_inspect` / `fleet_send` / `fleet_steer` / `fleet_cancel` 只 `inject: ['fleet']`（以及 `tools`）。`fleet_inspect` 默认限流。配置开关控制写入类工具。在现有 Web Session 里手工验证“A 取消 B”。

## L3 — Preset

`supervisor` preset 在 agent 平面挂 fleet Consumer；需要扇出时再挂 workflow，并指定 `subagentProvider`。主管自己尽量不带 bash/fs。事件归约后才唤醒。Fleet Provider 仍在 host。

## L4 — 传输

独立 `supervisor` profile，不加载官方 frontend。stdio（或后续 Named Pipe）作为 ApiProxy/Fleet 的新 carrier。协议带 `protocolVersion`。

## L5 — 桌面

Electron Main spawn `dsh --profile supervisor`。Renderer 经 preload IPC，不直接打 `file://` → HTTP。

## L6 — 产品化

常驻 daemon、多 Runtime 作为**另一个 Fleet Provider**、审批分级、官方新缝出现后的回收。
