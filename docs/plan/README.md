# 计划组

本目录只写**尚未完成或按阶段切开的工作**。产品边界见 [../product.md](../product.md)，挂载方式见 [../architecture.md](../architecture.md)。

## 当前状态

**L2.5 已完成**：selected `send` 返回 caller-bound single-observer reply receipt；Provider 通过 exact inbox claim 观察完整 turn，并以可选 Jobs Consumer 提供 `fleet_wait`，不 busy-poll、不等待 whole-Agent idle，也不 cancel target。

**L2.4 已完成**：confirmed-target selected `send` / `steer` 现在使用 Provider 生成的 versioned `fleet-relay` source，ToolRuntime 提供的 exact caller Agent 提供 sender，Provider 生成 opaque delivery correlation；direct API 保持 plugin attribution。正文、receipt、inspect projection、durability 和 fail-closed 边界已通过 keyless 验收。

**L2.3 已完成**：Fleet 的 live Agent 视图可机会式读取可选 `sessionTitle` 服务中 exact Session 已记录的标题，并为 inspect 分开报告 tail omission 与每条消息文本截断。标题服务缺失、卸载或没有已记录标题时不影响 Fleet；标题不参与 identity、routing、selection、排序、过滤或授权。关键输出已通过 keyless 单测、工具 schema/render、可选服务卸载、真实 Loader composition 和构建产物回归。

Delegated child 写入、主管 Agent、跨进程/远程 transport、Web 产品面、Electron、daemon 和多 runtime control 都还没开始。下一项能力变更应单独定义阶段范围。

## 文档

| 文件 | 内容 |
|---|---|
| [decisions.md](decisions.md) | 已锁定、实现不得推翻的决定 |
| [layers.md](layers.md) | L0–L6 全景和依赖 |
| [phase-l0.md](phase-l0.md) | 仓库骨架、pnpm、bundle 安装 |
| [phase-l1.md](phase-l1.md) | FleetService、当前同进程 Provider、测试套件 |
| [phase-l2.md](phase-l2.md) | `fleet_*` 工具 Consumer、模型输出和真实 ToolRuntime 验收 |
| [phase-l2.1.md](phase-l2.1.md) | AgentRegistry runtime ownership 分类、生命周期缓存和回归验收 |
| [phase-l2.2.md](phase-l2.2.md) | caller-bound target reference、exact-Agent selection 和 fail-closed write protocol |
| [phase-l2.3.md](phase-l2.3.md) | optional title discovery、inspect omission 和 text truncation fidelity |
| [phase-l2.4.md](phase-l2.4.md) | versioned attributed confirmed-target relay |
| [phase-l2.5.md](phase-l2.5.md) | exact claimed-turn reply observation 与 optional Jobs Consumer |

后继阶段（L3+）有代码需求时再单开一页，不要提前写实现规格。

## 推进规则

1. 上一层没有验收通过，不开始下一层。
2. 实现只依赖 [architecture.md](../architecture.md) 列出的公开缝。
3. 包管理只用 **pnpm**。
4. 运行时钉 `@deepseek-ai/dsh@0.1.0-rc.6`；源码 checkout 仅作阅读参考。
