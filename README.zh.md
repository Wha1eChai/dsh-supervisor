# dsh-cross-session

[English](README.md) | 中文

让同一运行中 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的多个 live Session 互相发现、发送消息并协调工作。

- 运行在现有 `dsh` runtime 内
- 不启动 daemon、第二套 Agent runtime 或独立网络端口
- 作为普通 DSH 插件安装

**当前版本：** `@wha1echai/dsh-cross-session@0.1.0-rc.1`，适配 DSH `0.1.0-rc.6`。

这是独立的社区项目，与 DeepSeek AI 不存在隶属或官方背书关系。

## 为什么需要跨 Session 通信？

一个 Session 往往已经拥有你需要的上下文：正在进行的实现、带有关键证据的调查，或应与主对话保持分离的评审。把这些历史复制到新聊天里可能丢失上下文，也会增加协调成本。

`dsh-cross-session` 让一个 live Session 在不创建第二套 harness 的前提下与另一个 Session 协作：

- **在上下文所在的位置继续工作。** 把后续任务发给已经负责该工作的 Session。
- **协调并行任务。** 查看另一个 Session 的状态、补充方向，并观察它产生的 turn。
- **保持职责分离。** 用不同 Session 承担实现、评审、研究或长时间任务，同时让它们留在同一个 DSH runtime 中。

## 它能做什么

| 动作 | 含义 | 工具 |
|---|---|---|
| 发现 | 列出当前 `dsh` 进程中的 live Session | `fleet_list` |
| 查看 | 读取另一个 live Session 的有限摘要 | `fleet_inspect` |
| 发送 | 把后续工作排入目标的下一 turn | `fleet_send` |
| 转向 | 在目标的下一 step boundary 修改工作方向 | `fleet_steer` |
| 等待 | 观察认领已发送消息的完整 turn | `fleet_wait` |
| 取消 | 显式启用后停止 root Session 的活动工作 | `fleet_cancel` |

**Send 与 steer：** 工作应等待目标的下一 turn 时使用 `fleet_send`；需要在当前 turn 的下一 step boundary 改变方向时使用 `fleet_steer`。目标 idle 时，steer 也会唤醒它并以该输入开始一个 turn。

## 快速开始

### 1. 安装 prerelease

```sh
dsh plugin --profile web add @wha1echai/dsh-cross-session@0.1.0-rc.1
dsh --profile web --dump-config
```

如果只是评估插件，建议使用隔离的 `DSH_HOME`，避免修改已有 profile。

npm 要求每个包保留 `latest`。由于当前只有这一个已发布版本，`latest` 和 `next` 都会解析为 `0.1.0-rc.1`；建议使用完整版本或 `next`，让 prerelease 安装意图保持清晰。

### 2. 启用消息

Bundle 默认只启用只读发现。在 profile 的 `cordis.patch.yml` 中加入以下配置，以启用 `fleet_send` 和 `fleet_steer`：

```yaml
- id: dsh-cross-session-tools
  name: '@wha1echai/dsh-cross-session/tool'
  config:
    controlMode: message
```

工具可见性模式：

| `controlMode` | 可用工具 |
|---|---|
| `read-only` | `fleet_list`、`fleet_inspect` |
| `message` | 只读工具，加上 `fleet_send`、`fleet_steer` |
| `full` | 消息工具，再加上 `fleet_cancel` |

只有明确允许模型执行取消的 composition 才使用 `full`。可选的回复等待需与官方 Jobs 工具共同配置，详见[等待回复](#等待回复)。

### 3. 启动 DSH

```sh
dsh --profile web
```

在该 runtime 中打开两个 live root Session。插件使用 Web profile 所在的同一个进程；如果 DSH 监听 3080，插件不会再打开另一个端口。

## 试一试

在目标 Session 中输入：

```text
收到 Fleet 消息后，先简要概括请求，再正常完成任务，
最后返回一段简短结果。
```

在调用 Session 中输入：

```text
找到另一个 live root Session，查看并确认它，然后发送一个小任务。
如果 fleet_wait 可用，再等待接收该消息的 turn 完成。
```

预期流程：

```text
调用方发现目标
  → 调用方查看并确认目标
  → 目标收到后续工作
  → 目标完成下一 turn
  → 调用方可选地通过 fleet_wait 观察认领消息的 turn
```

## 操作安全

- `fleet_send` 和 `fleet_steer` 可能触发模型请求和工具调用，因此可能消耗模型与工具资源。
- `fleet_cancel` 会中断活动工作，但无法回滚模型或工具已经接受的工作。
- 只在确实需要这些能力的 Agent composition 中启用写模式。
- `controlMode` 只控制模型可见工具，不替代 DSH approval、`tools/pre-execute` 或 `ctx.tools.guard()` 策略。

完整的副作用和 late-abort 语义见 [Fleet 参考](docs/reference/fleet.md)。

## 目标确认机制

模型工具不会直接向任意 Session ID 写入，而是经过一个简短的确认流程：

```text
fleet_list
  → 选择 live 目标

fleet_inspect
  → 确认 exact 目标

fleet_send / fleet_steer / fleet_cancel
  → 对已确认 selection 执行动作
```

Target reference 和 selection 都是短期、caller-bound、fail-closed 的能力。如果目标消失、被替换、过期或 Provider 卸载，selection 不会静默切换到另一个 Session。写 selection 固定为 single-attempt。

可信程序化 Consumer 仍可通过 direct `ctx.fleet` Service API 使用 `sessionId`。Confirmed-target 流程是模型可见的安全路径。

## 等待回复

`fleet_send` 返回 caller-bound reply receipt。可选 reply-job Consumer 会增加 `fleet_wait`；该工具创建 owner-scoped DSH Job，并观察认领 exact sent message 的完整 turn。

请把该 Consumer 与官方 Jobs tool Consumer 挂在同一个 composition scope。对于使用 Agent preset 的 Web profile，请先复制一个随 DSH 提供的 preset，在用户自有 preset 中把以下 row 放到 `@deepseek-ai/dsh-tool-jobs` row 旁边，再让调用 Session 选择该 preset：

```yaml
- id: dsh-cross-session-reply-job
  name: '@wha1echai/dsh-cross-session/reply-job'
```

用户自有 preset 通常位于 `$DSH_HOME/.agent-presets/<id>/agent.cordis.yml`。不要编辑 DSH 安装目录中随附的 preset；当官方 Jobs 工具按 preset 挂载时，也不要把 reply-job 全局挂载。工具可见性由各 Consumer 执行注册时所在的 Cordis context 决定。

结果属于认领消息的 turn，但不声称该 turn 中的每个 assistant token 都只由这一条消息因果产生。

Timeout、abort 或 job cancellation 只停止观察，不会 cancel、steer 或替换目标 Session。Job output、list、kill 和 completion notice 继续由官方 Jobs 能力负责。

## 当前范围

### 当前支持

- 同一个运行中 `dsh` 进程里的 live Session；
- root Session 发现和有限摘要；
- confirmed send、steer 和可选 cancel；
- exact claimed-turn reply observation；
- DSH 已经记录的可选展示标题；
- 正常的 DSH Web、CLI 或其他 host composition。

### 当前不提供

- 第二套 harness、Agent runtime 或 daemon；
- 独立网络端口；
- 跨进程、跨设备或多 runtime 通信；
- remote-control gateway；
- 专用的多 Session Web 或桌面 UI；
- delegated Session 写入，该能力仍应通过未来的官方 subagent seam 接入。

## 它如何接入 DSH

```text
模型工具 ─────────┐
未来 UI ──────────┼──> FleetService（ctx.fleet）<── InProcessFleetProvider
其他插件 ─────────┘                                  │
                                                      └── live Agent registry
```

Consumer 依赖 `ctx.fleet`，不会直接调用 Agent 方法。当前 Provider 只操作同一进程中的 live Agent。Delegated Session 控制继续属于 `ctx.subagents`，编排继续属于 `ctx.workflowEngine`，后台生命周期继续属于 `ctx.jobs`。

生命周期规则、配置 limits、API、错误码和扩展点见[架构文档](docs/architecture.md)与 [Fleet 参考](docs/reference/fleet.md)。

## 兼容性

| 组件 | 支持版本 |
|---|---|
| `dsh-cross-session` | `0.1.0-rc.1` |
| DeepSeek Harness | `0.1.0-rc.6` |
| Node.js | `^22.19.0` 或 `>=24.0.0` |
| 仓库包管理器 | pnpm `11.7.0` |

Release candidate 使用精确版本是有意设计。后续 DSH 版本在完成验证前不视为兼容。

## 其他安装方式

### 本地 checkout

```sh
git clone https://github.com/Wha1eChai/dsh-cross-session.git
cd dsh-cross-session
pnpm install
pnpm run build

dsh plugin --profile web add /absolute/path/to/dsh-cross-session
```

### 固定 commit 的 GitHub 源

```sh
dsh plugin --profile web add github:Wha1eChai/dsh-cross-session#<commit>
```

Git 安装会执行 `prepare` 构建 TypeScript。pnpm 10 及以上要求在 profile 的 `pnpm-workspace.yaml` 中显式允许：

```yaml
allowBuilds:
  '@wha1echai/dsh-cross-session': true
```

授予安装时执行权限前，应先审查并固定源码 commit。如果首次 add 因构建脚本未授权而失败，请把 pnpm 输出的精确包名加入该 profile 的 `pnpm-workspace.yaml`，然后重新运行同一条 `dsh plugin --profile web add` 命令。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack --pack-destination .pack-output/dev
pnpm run check:packed -- .pack-output/dev
```

测试使用真实 DSH `ToolRuntime` 和 Loader composition，覆盖目标确认、生命周期失效、relay 归因、reply observation、scoped tool visibility、卸载，以及 packed JavaScript/declaration entries。

详见 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md) 和[发布与回滚](docs/release.md)。

## 路线图

- 通过官方 subagent capability 支持 delegated Session 消息；
- 提供更清晰、组合现有 DSH 能力的 supervisor-oriented preset；
- 提供一等的多 Session Web 体验；
- 为经过明确设计的多 runtime 通信增加其他 Provider；
- 验证后续 DSH release candidate 的兼容性。

详细的已交付里程碑、未来分层和 non-goals 维护在 [docs/plan/](docs/plan/README.md)。

## 项目状态

`dsh-cross-session` 是独立社区项目，与 DeepSeek AI 不存在隶属或官方背书关系。

使用 [MIT License](LICENSE)。
