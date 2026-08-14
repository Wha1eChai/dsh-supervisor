# dsh-supervisor

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的社区插件，当前专注于同一运行中 DSH runtime（即同一个 `dsh` 进程）内 live Session 之间的发现、寻址和通信。它提供可替换的 `ctx.fleet` 服务，并通过该服务提供模型可调用的 `fleet_*` 工具。

> **状态：Tool Preview（L0 + L1 + L2 + L2.1 + L2.2 + L2.3 + L2.4 + L2.5）。** Fleet 现在支持可选的日志标题展示、inspect 截断事实区分、confirmed-target attributed relay，以及 exact claimed-turn reply observation。Fleet 服务、authoritative runtime ownership 分类、五个核心工具和可选 Jobs Consumer 已经实现，并通过构建后 package entry 的 keyless 测试。当前产品面是 API 和模型工具，不是多 Session UI 或远程控制服务。

这是独立的社区项目，与 DeepSeek AI 不存在隶属或官方背书关系。

## 设计

DeepSeek Harness 把能力设计成可热替换的插件缝。本项目遵循相同结构：

```text
FleetService                  Service Definition（ctx.fleet）
InProcessFleetProvider        同进程 Provider（ctx.agents）
fleet_* tools                 当前 Consumer（ctx.fleet + ctx.tools）
supervisor preset             计划中的 Consumer（L3）
profile / surface / transport 未来 Consumer（L4+）
```

Fleet 工具 Consumer 不导入 Agent 或 Subagent API，也不访问 `ctx.agents`、`ctx.sessions` 或 `ctx.subagents`，并且只注册 `fleet_*` 工具。本插件不替换或复制已有的 subagent、workflow 能力：

- delegated Session 的继续写入和中断属于公开 `ctx.subagents` seam 及其官方 Consumer；
- 编排属于公开 `ctx.workflowEngine` seam 及其官方 Consumer；
- Fleet 只补同一进程内的 live Session 视图和有限 root Session 控制。

Subagent 和 workflow 工具属于可选 profile 组合。只有对应公开 seam 和 Consumer 都已挂载时，模型才能看到这些工具；Fleet 不会广告不可用的能力。

完整约束见 [docs/architecture.md](docs/architecture.md)。

## 当前能力

`ctx.fleet` 提供：

- `list()` — 列出当前 DSH 进程的 live Agent；
- `inspect()` — 返回有限且 JSON-safe 的对话摘要；
- `send()` — 给 live root Agent 排入 plugin-source follow-up；
- `steer()` — 转向 live root Agent；
- `cancel()` — 使用稳定 Fleet 原因取消 live root Agent；
- `subscribe()` — 观察投影后的 created/status/disposed 事件。

confirmed-target 模型 `fleet_send` / `fleet_steer` 使用 versioned `fleet-relay` source。exact caller Agent 提供 `senderSessionId`，Provider 提供 opaque `deliveryId`。模型可见 header 同时编码两者；固定 marker 之后的正文从独立 text block 开始，按原文保留为不可信模型输入，不能覆盖结构化归因。

独立入口 `@wha1echai/dsh-supervisor/tool` 注册：

- 所有模式都有 `fleet_list` 和 `fleet_inspect`；
- `message` 和 `full` 模式增加 `fleet_send` 与 `fleet_steer`；
- 只有 `full` 模式增加 `fleet_cancel`。

挂载该 Consumer 后，已运行的 Session 会通过正常 ToolRuntime 组合，在下一次模型请求中看到当前配置的工具。它不会注入合成聊天消息，也不依赖永久 system prompt prose 来宣布 Fleet。

可信程序化 Consumer 的 direct Service API 继续以 `sessionId` 作为当前 runtime 内的稳定路由标识。Selected steer receipt 包含 opaque `deliveryId`；selected send 还返回 caller-bound、single-observer 的 `replyReceipt`。Delivery 仍只表示 inbox 接受。`waitForReply()` 之后观察 claim exact message 的完整 turn，不用 Agent idle 作为证明，也不声称严格的 message-to-message 因果。模型工具改用 confirmed-target protocol：`fleet_list` 返回 caller-bound `targetRef`，`fleet_inspect` 接受该 reference，并可能签发 exact-Agent-bound、single-attempt 的 `selectionHandle`；写工具只接受 selection。无效、过期、caller mismatch、Agent replacement、Provider unload 或已使用的 handle 都 fail closed，绝不授权替换为其他 Session。每个 Agent view 仍包含 `sessionId`；未来任何 Session-list UI 都必须显示它并提供复制操作。

`controlMode` 默认是 `read-only`。五个 confirmed-target 工具都把 owning Agent 的 exact object 传给 Provider，并从它派生 Session id 做交叉校验；模型字段不能提供 caller identity，没有 owning Agent 时直接失败。写授权继续由 `ctx.fleet` 判断。Fleet 通过 exact Agent 是否属于 `ctx.agents.roots()` 来分类 runtime root；durable `origin` 和 `parentSession` 元数据不影响 `kind` 或写授权。L2.1 中 delegated Agent 仍为只读，Consumer 不会绕过 Fleet 直接调用 subagent API。

可选入口 `@wha1echai/dsh-supervisor/reply-job` 只在 `ctx.jobs` 已挂载时注册 `fleet_wait`。它创建 owner-scoped `fleet-reply` 后台 job；output/list/kill、controller 和 completion notice 继续由官方 job tools 负责。Kill job 只 abort reply observation，不 cancel target。应把该 Consumer 与官方 Jobs Consumer 挂在同一个 host 或 agent preset composition 中；它的 scoped ToolRuntime 注册会跟随该 composition。

挂载可选的 `sessionTitle` 服务后，Fleet 只从 exact live Session 读取日志中已经记录的标题，并把它作为 list/inspect 的展示字段。标题服务缺失或卸载时 Fleet 仍可用，只省略 `title`；标题不影响 identity、routing、selection、顺序、过滤或授权。Inspect 另外报告 tail limit 省略的消息数和每条消息的 `textTruncated` 事实。

API、配置、工具和错误码见 [docs/reference/fleet.md](docs/reference/fleet.md)。

## 当前范围

进程内 Provider 只能看到同一运行中 DSH runtime，也就是同一个 `dsh` 进程里的 live Session。当前版本不提供：

- 跨进程或多 runtime 的发现和控制；
- 跨终端或跨设备路由；
- 本地到服务器控制；
- remote Web、gateway 或 daemon 支持；
- 多 Session Web 或桌面 UI。

下面使用的 `web` profile 只是现有 DSH 安装和开发宿主，不表示本插件提供 remote Web 支持或 supervisor UI。Web 可以保留为未来的一等产品面，Electron 可以作为可选 wrapper，但两者都次于当前同 runtime 通信目标。

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

Bundle 只安装 host-plane Fleet Provider。核心工具 Consumer 和可选 reply-job Consumer 应挂在需要这些能力的 Agent composition 中，避免向 sibling preset 暴露 Fleet 工具。对于尚未使用 preset 的 host composition，则把同样的行加入对应 profile。

```yaml
- id: dsh-supervisor-tools
  name: '@wha1echai/dsh-supervisor/tool'
  config:
    controlMode: message # read-only | message | full

- id: dsh-supervisor-reply-job
  name: '@wha1echai/dsh-supervisor/reply-job'
```

核心 Consumer 的安全默认值暴露 `fleet_list` 和 `fleet_inspect`。只有 composition 挂载可选 reply-job Consumer 且能解析 public Jobs seam 时才会出现 `fleet_wait`；实际启动 job 还要求 owner 的 composition 挂载官方 Jobs controller Consumer。它只能消费已启用 `fleet_send` 返回的 reply receipt。

如需改变消息或取消工具可见性，在完整的 `dsh-supervisor-tools` 行上设置 `controlMode`。只有在明确允许模型取消其他 root Session 的 composition 中才使用 `full`。`controlMode` 只选择工具可见性，不替代 `tools/pre-execute`、approval 或 `ctx.tools.guard()` 策略。

其他插件也可以把 `fleet` 声明为必需服务，直接消费 Fleet：

```ts
export const inject = ['fleet']

export function apply(ctx: Context) {
  const live = ctx.fleet.list()
  // 使用同 runtime 的 JSON-safe 视图构建未来命令或 UI adapter。
}
```

这些 Consumer 是独立插件，不包含在当前包中。任何未来 transport 或 remote Consumer 还需要单独的身份、传输和权限设计；当前 `sessionId` 不得被视为全局远程地址。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack
```

测试使用真实 `ToolRuntime`，验证 canonical value 和模型可见内容，并通过官方 Loader + Include 从 test-only `cordis.yml` 加载构建后的 Provider、tool 和 reply-job entry。测试还明确防止所有 namespace entry 出现 `default` export，并验证 Provider/Consumer 卸载。

## 路线 / TODO

- [x] **L0** — 可安装 Bundle、构建、包元数据、真实 Loader smoke。
- [x] **L1** — `FleetService`、进程内 Provider、生命周期隔离、keyless 测试。
- [x] **L2** — `fleet_list`、`fleet_inspect`、`fleet_send`、`fleet_steer`、`fleet_cancel` 工具 Consumer。
- [x] **L2.1** — 通过 exact Agent 是否属于 `ctx.agents.roots()` 权威分类 runtime root/delegated，并与 durable lineage 元数据解耦。
- [x] **L2.2** — caller-bound target reference 和 exact-Agent-bound single-attempt selection，保证模型写入 fail closed。
- [x] **L2.3** — 可选日志标题发现，以及 inspect omission/text-truncation 事实保真。
- [x] **L2.4** — versioned attributed confirmed-target relay、exact caller 归因和 delivery correlation。
- [x] **L2.5** — exact claimed-turn reply observation，以及不 busy-poll、不取消 target 的可选 `ctx.jobs`-backed `fleet_wait`。
- [ ] **L2b** — 通过公开 subagent seam、携带精确 parent authority 的 delegated Session 写 API。
- [ ] **L3** — 条件组合现有 Fleet、subagent 和 workflow Consumer 的 supervisor Agent preset。
- [ ] **L4+** — 未来独立 profile、一等产品面和 transport；这些都不是当前支持。
- [ ] **L5 可选项** — 在未来受支持产品面之上的可选 Electron wrapper。
- [ ] **L6+** — 未来 daemon 和多 runtime Fleet Provider。
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

欢迎通过本仓库提交 bug、设计反馈和范围清晰的 Pull Request。贡献必须保留 capability seam：Consumer 依赖 `ctx.fleet`，delegated 写入通过未来的 Fleet API 接入 `ctx.subagents`，编排留在 `ctx.workflowEngine`，模型可见能力由 profile 中实际挂载的 seam 和 Consumer 决定。

## 协议

[MIT](LICENSE)
