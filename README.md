# dsh-supervisor

DeepSeek Harness 的外部控制面插件：在同一个 `dsh` 进程里观察并调度 live Session，而不是另做一个 agent runtime。

官方仓库不接受外部 PR。本仓库独立维护，通过 `dsh plugin add` 安装进用户 profile。

## 当前阶段

**L0 + L1**：可安装 Bundle + 进程内 `FleetService`。

后续的主管 Agent、stdio 传输和 Electron 壳都消费这一层，不另起运行时。

## 文档

从 [docs/README.md](docs/README.md) 进入。计划组在 [docs/plan/README.md](docs/plan/README.md)。

## 运行时钉扎

第一阶段只针对已发布的 `@deepseek-ai/dsh@0.1.0-rc.6`。升级官方 runtime 时单独做兼容回归，不承诺跨 rc 兼容。

## 安装和验证

使用隔离的 DSH home 开发：

```powershell
$env:DSH_HOME = "D:\coding\programs\dsh\.dsh-supervisor-home"
dsh plugin --profile web add D:\coding\programs\dsh\dsh-supervisor
dsh --profile web --dump-config
dsh --profile web
```

L1 只提供 `ctx.fleet` Service，尚未注册模型可调用的 `fleet_*` 工具。API 和配置见 [docs/reference/fleet.md](docs/reference/fleet.md)。

## 开发

使用 **pnpm**。不要引入 npm / yarn lockfile。

```powershell
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```
