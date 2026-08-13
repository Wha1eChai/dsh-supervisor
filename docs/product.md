# 产品

`dsh-supervisor` 是 DeepSeek Harness 上的**控制面能力缝**：让同一个 `dsh` 进程里的 live Session 可被列出、检查、发送、转向和取消。

它不是第二个 harness，也不是绕过官方生态另写的调度内核。

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
| `ctx.subagents` | 委托注册表 | 子 Agent 跑在本进程、fork、ACP、别的 runtime |
| `ctx.workflowEngine` | 编排引擎 | worker-thread / 未来进程或沙箱 |
| `ctx.llm` / `ctx.shell` / `ctx.tools` | 各能力 | adapter、后端、策略 |

本仓库的实现必须是同一形状：

```text
ctx.fleet            Definition（词汇与权限）
default provider     当前进程的 live Agent / Session
later providers      stdio 对端、多 Runtime、只读观察
fleet_* tools        Consumer（模型）
supervisor preset    Consumer（组合）
transport / Electron Consumer（进程外）
```

因此：

- 工具和桌面只依赖 `ctx.fleet`，不直接操作 `Agent`。
- 子 Session 的继续写入和中断走 **`ctx.subagents`**，不在 Fleet 里再发明一套 child API。
- 主管侧的扇出和脚本编排走 **`ctx.workflowEngine`**，不在 Fleet 里做第三个调度器。
- Provider 可卸载；卸载后停止新操作，不撤销已交出的调用约定。

## 要解决的问题

官方 Web UI 面向单会话对话。多 Session 并行时，缺少统一的观察和调度层。

本产品补这一层，并保持用户仍运行官方 `dsh`。调度层本身也必须能被替换，否则会和官方生态拧着走。

## 不是什么

- 不是独立 agent runtime。
- 不是官方 `deepseek-ai/deepseek-harness` 的 fork 产品面。
- 不发布同名 `@deepseek-ai/*` 包去覆盖官方实现。
- 不把 `followup` / `steer` / `cancel` 写进模型工具里当“实现”。
- 不绕过 `subagents` 去 `followup` 子 Agent。
- 第一阶段不做 Electron、不做跨进程聚合、不销毁任意 Agent。

## 用户感知

```text
安装官方 dsh
安装本插件到一个 profile
在现有 dsh 会话里用 fleet_* 调度其他 Session
后续可选：supervisor preset、桌面壳
```

桌面 EXE 若出现，只是调起并连接 `dsh` 的壳，并且仍通过 Fleet Consumer 说话。

## 分发

- 代码在本仓库，包名 `@wha1echai/dsh-supervisor`。
- 安装走 `dsh plugin --profile <name> add <path-or-spec>`。
- 官方不接受外部 PR；能力回馈官方的方式是保持公开缝，而不是往他们 monorepo 塞代码。

## 收益假设

DeepSeek 主推自有 harness 和可插拔生态。控制面必须长在这条生态上：同一套 Provider 替换、同一套 subagent/workflow 委托，才能被后续官方 UI、ACP、preset 复用。自己再做 runtime 或平行控制协议，会同时失去分发和维护杠杆。
