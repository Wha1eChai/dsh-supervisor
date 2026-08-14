# 产品

`dsh-supervisor` 当前首先解决同一运行中 DSH runtime（即同一个 `dsh` 进程）内 live Session 之间的发现、寻址和通信。它提供 **Fleet capability seam** 和模型可调用的 `fleet_*` 工具，让一个 live Session 观察或控制另一个 live Session。可信程序化 Consumer 使用稳定 `sessionId`；模型工具使用 Provider 签发的短期 target reference 和 write selection。

当前产品面是进程内 Service/API 和模型工具，不是第二个 harness、远程控制服务或多 Session UI。

## 核心哲学（必须遵守）

DSH 的产品单元是 **capability seam**，不是“一个功能函数”：

```text
Service Definition   拥有 ctx.<key> 和词汇
Service Provider     可热替换的实现
Consumer             注入该服务的工具 / preset / UI / 传输
```

官方已经用同一套哲学做了：

| 缝 | Definition | 可替换的是什么 |
|---|---|---|
| `ctx.subagents` | 委托注册表 | 子 Agent 的 Provider |
| `ctx.workflowEngine` | 编排引擎 | worker-thread / 其他受支持实现 |
| `ctx.llm` / `ctx.shell` / `ctx.tools` | 各能力 | adapter、后端、策略 |

本仓库当前交付的结构是：

```text
ctx.fleet                 Definition（词汇与权限）
in-process provider       同一 dsh 进程的 live Agent / Session
fleet_* tools             当前 Consumer（模型）
supervisor preset         未来 Consumer（组合）
Web / Electron / transport 未来可选 Consumer 或产品面
```

因此：

- 工具和未来产品面只依赖 `ctx.fleet`，不直接操作 `Agent`。
- 子 Session 的继续写入和中断走 **`ctx.subagents`**，不在 Fleet 里再发明一套 child API。
- 主管侧的扇出和脚本编排走 **`ctx.workflowEngine`**，不在 Fleet 里做第三个调度器。
- Provider 可卸载；卸载后停止新操作，不撤销已交出的调用约定。

## 要解决的问题

多个 live Session 在同一个 DSH runtime 中并行时，需要能发现彼此，并使用明确、稳定的标识完成模型驱动的跨 Session 通信。Fleet 当前补的是这一进程内 Service 和工具层。可选的 log-backed session title 只增强发现和 inspect 的展示，不增加标题生成能力，也不改变 Fleet 的 live scope。

官方对话 UI 不是当前实现面。本包目前不提供多 Session Web UI、Session 管理列表、远程 Web 服务或桌面应用；任何 UI 都是未来 Consumer。

## 能力如何出现

模型可见能力由 profile 中实际挂载的 seam、Consumer 和当前 tool registry 决定：

- 只有挂载 `@wha1echai/dsh-supervisor/tool` 才注册 `fleet_*`。
- Consumer 在 Session 已运行后挂载或重配时，该 Session 会在下一次模型请求中通过正常 ToolRuntime 组合看到当前工具集合。
- 不插入 user、assistant 或其他聊天消息来通知模型。
- 不增加只为广告工具存在而常驻的 system prompt prose。
- Fleet Consumer 只暴露 `fleet_*`，不会因为检测到 `ctx.subagents` 或 `ctx.workflowEngine` 就暴露对应工具。
- Subagent 和 workflow 行为只有在各自公开 seam 和官方 Consumer 都已挂载时才可见。未来 supervisor preset 只能组合这些 Consumer，不得复制工具实现、schema 或宣传未挂载能力。

## 身份与寻址

`sessionId` 是当前 DSH runtime 内第一等、稳定的 Fleet 路由标识：

- direct Fleet Service API 继续以 `sessionId` 寻址可信程序化 Consumer。
- `fleet_list` 的模型 canonical output `{ agents, count }` 中，每个 Agent 视图同时包含 `sessionId` 和 caller-bound `targetRef`。
- 模型先用 `target_ref` inspect；Provider 确认 exact target 后签发 single-attempt `selectionHandle`，send/steer/cancel 只接受该 handle。
- Handle 损坏、过期、caller mismatch、Agent replacement 或 Provider unload 都 fail closed，不会替换目标。
- 未来任何面向人的 Session-list UI 必须展示 `sessionId` 并提供复制操作；当前没有该 UI。
- `sessionId` 不是已定义的跨 runtime 或全局远程地址。未来多 runtime 支持必须另外设计 runtime namespace 和寻址。

## 不是什么

- 不是独立 Agent runtime。
- 不是官方 `deepseek-ai/deepseek-harness` 的 fork 产品面。
- 不发布同名 `@deepseek-ai/*` 包去覆盖官方实现。
- 不把 `followup` / `steer` / `cancel` 写进模型工具里当“实现”。
- 不绕过 `subagents` 去 `followup` 子 Agent。
- 当前不支持跨进程、跨终端或跨设备、从本机连接服务器、remote Web、gateway、daemon 或多 runtime 聚合控制。
- 当前不提供多 Session Web UI 或 Electron 应用，也不销毁任意 Agent。

## 用户感知

```text
安装官方 dsh
安装本插件到一个 profile
在现有 live Session 中用 fleet_* 与同一 dsh 进程的其他 live Session 通信
未来可选：supervisor preset、Web 产品面、Electron wrapper
```

安装示例使用现有 `web` profile 作为宿主，不表示插件已经提供 remote Web 或 supervisor UI。Web 可作为未来一等产品面；Electron 若出现，只是可选 wrapper，并且二者都次于当前同 runtime 通信目标。

## 分发

- 代码在本仓库，包名 `@wha1echai/dsh-supervisor`。
- 安装走 `dsh plugin --profile <name> add <path-or-spec>`。
- 这是独立社区插件，不承诺 DeepSeek 官方采用。

## 收益假设

保持公开 capability seam，可让未来兼容 Consumer 在明确组合和支持范围内接入同一 Fleet API。当前不承诺官方 UI、ACP、gateway、远程 transport 或多 runtime 集成；这些能力若推进，必须作为后续阶段单独设计和验证。
