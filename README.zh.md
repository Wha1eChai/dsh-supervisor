# dsh-supervisor

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的社区控制面插件。它提供可替换的 `ctx.fleet` 服务，用于观察和控制同一个 `dsh` 进程中的 live Session，并通过该服务提供模型可调用的 `fleet_*` 工具。

> **状态：Tool Preview（L0 + L1 + L2）。** Fleet 服务和五个工具 Consumer 已经实现，并通过 package entry 的 keyless 测试。

这是独立的社区项目，与 DeepSeek AI 不存在隶属或官方背书关系。

## 设计

DeepSeek Harness 把能力设计成可热替换的插件缝。本项目遵循相同结构：

```text
FleetService                  Service Definition（ctx.fleet）
InProcessFleetProvider        默认 Provider（ctx.agents）
fleet_* tools                 Consumer（ctx.fleet + ctx.tools）
supervisor preset / transport 计划中的 Consumer（L3+）
```

工具 Consumer 不导入 Agent 或 Subagent API，也不访问 `ctx.agents`、`ctx.sessions` 或 `ctx.subagents`。本插件不替换已有的 subagent 或 workflow runtime：

- delegated Session 的继续写入和中断属于 `ctx.subagents`；
- 编排属于 `ctx.workflowEngine`；
- Fleet 只补当前进程的 live Session 观察和有限 root 控制。

完整约束见 [docs/architecture.md](docs/architecture.md)。

## 当前能力

`ctx.fleet` 提供：

- `list()` — 列出当前进程的 live Agent；
- `inspect()` — 返回有限且 JSON-safe 的对话摘要；
- `send()` — 给 live root Agent 排入 plugin-source follow-up；
- `steer()` — 转向 live root Agent；
- `cancel()` — 使用稳定 Fleet 原因取消 live root Agent；
- `subscribe()` — 观察投影后的 created/status/disposed 事件。

独立入口 `@wha1echai/dsh-supervisor/tool` 注册：

- 所有模式都有 `fleet_list` 和 `fleet_inspect`；
- `message` 和 `full` 模式增加 `fleet_send` 与 `fleet_steer`；
- 只有 `full` 模式增加 `fleet_cancel`。

`controlMode` 默认是 `read-only`。写工具只从 owning Agent Session 派生 caller identity；没有 owning Agent 时直接失败；self/delegated 权限继续由 `ctx.fleet` 判断。L2 中 delegated Agent 仍为只读，Consumer 不会绕过 Fleet 直接调用 subagent API。

API、配置、工具和错误码见 [docs/reference/fleet.md](docs/reference/fleet.md)。

## 运行要求

- Node.js `^22.19.0` 或 `>=24.0.0`
- 仓库开发使用 pnpm `11.7.0`
- `@deepseek-ai/dsh@0.1.0-rc.6`

第一条发布线不承诺跨 DSH release candidate 兼容。

## 安装

目前尚未发布 npm 包。请使用本地 checkout，或固定 commit 的 GitHub 源安装。

### 本地 checkout

```sh
git clone https://github.com/Wha1eChai/dsh-supervisor.git
cd dsh-supervisor
pnpm install
pnpm run build

dsh plugin --profile web add /absolute/path/to/dsh-supervisor
dsh --profile web --dump-config
dsh --profile web
```

PowerShell 开发时使用隔离的 DSH home，不要修改已有用户 profile：

```powershell
$env:DSH_HOME = "D:\coding\programs\dsh\.dsh-supervisor-home"
dsh plugin --profile web add D:\coding\programs\dsh\dsh-supervisor
dsh --profile web --dump-config
dsh --profile web
```

### GitHub 源安装

固定已审查的 commit：

```sh
dsh plugin --profile web add github:Wha1eChai/dsh-supervisor#<commit>
```

Git 安装会执行包内的 `prepare` 来构建 TypeScript。pnpm 10 及以上默认拒绝该脚本，用户需要在 profile 的 `pnpm-workspace.yaml` 中显式允许：

```yaml
allowBuilds:
  '@wha1echai/dsh-supervisor': true
```

授予安装时执行权限前应先审查源码并固定 commit。添加授权后重新运行 `dsh plugin add`。

## 使用

Bundle 会安装两个 package entry。安全默认值只暴露 `fleet_list` 和 `fleet_inspect`。如需启用消息或取消工具，在 profile 的 `cordis.patch.yml` 中完整覆盖 `dsh-supervisor-tools` 行：

```yaml
- id: dsh-supervisor-tools
  name: '@wha1echai/dsh-supervisor/tool'
  config:
    controlMode: message # read-only | message | full
```

只有在明确允许模型取消其他 root Session 的 profile 中才使用 `full`。`controlMode` 只选择工具可见性，不替代 `tools/pre-execute`、approval 或 `ctx.tools.guard()` 策略。

其他插件也可以把 `fleet` 声明为必需服务，直接消费 JSON-safe Fleet API：

```ts
export const inject = ['fleet']

export function apply(ctx: Context) {
  const live = ctx.fleet.list()
  // 使用 JSON-safe 视图构建其他命令、UI adapter 或 transport。
}
```

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack
```

测试使用真实 `ToolRuntime`，验证 canonical value 和模型可见内容，并通过官方 Loader + Include 从 test-only `cordis.yml` 加载两个构建后的 package entry。测试还明确防止两个 namespace entry 出现 `default` export，并验证 Provider/Consumer 卸载。

## 路线 / TODO

- [x] **L0** — 可安装 Bundle、构建、包元数据、真实 Loader smoke。
- [x] **L1** — `FleetService`、进程内 Provider、生命周期隔离、keyless 测试。
- [x] **L2** — `fleet_list`、`fleet_inspect`、`fleet_send`、`fleet_steer`、`fleet_cancel` 工具 Consumer。
- [ ] **L2b** — 通过公开 subagent seam、携带精确 parent authority 的 delegated Session 写 API。
- [ ] **L3** — 使用 Fleet 和现有 workflow 缝的 supervisor agent preset。
- [ ] **L4** — 独立 profile 和本地传输。
- [ ] **L5** — 可选的 Electron 壳，只负责启动并连接 `dsh`。
- [ ] **L6** — daemon 和多 Runtime Fleet Provider。
- [ ] 完成用户可见验证后发布第一个 registry 包。
- [ ] 为每个支持的 DSH release candidate 添加兼容性 CI。

详细阶段边界见 [docs/plan/layers.md](docs/plan/layers.md)。

## 文档

从 [docs/README.md](docs/README.md) 开始：

- [产品边界](docs/product.md)
- [架构](docs/architecture.md)
- [已锁定决定](docs/plan/decisions.md)
- [Fleet API 参考](docs/reference/fleet.md)

## 参与贡献

欢迎通过本仓库提交 bug、设计反馈和范围清晰的 Pull Request。贡献必须保留 capability seam：Consumer 依赖 `ctx.fleet`，delegated 写入通过未来的 Fleet API 接入 `ctx.subagents`，编排留在 `ctx.workflowEngine`。

## 协议

[MIT](LICENSE)
