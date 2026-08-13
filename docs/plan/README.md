# 计划组

本目录只写**尚未完成或按阶段切开的工作**。产品边界见 [../product.md](../product.md)，挂载方式见 [../architecture.md](../architecture.md)。

## 当前焦点

**L2**：独立 `@wha1echai/dsh-supervisor/tool` Consumer，提供安全分级的 `fleet_*` 模型工具。

Delegated child 写入、主管 Agent、stdio、Electron 都还没开始。不要在本阶段实现它们。

## 文档

| 文件 | 内容 |
|---|---|
| [decisions.md](decisions.md) | 已锁定、实现不得推翻的决定 |
| [layers.md](layers.md) | L0–L6 全景和依赖 |
| [phase-l0.md](phase-l0.md) | 仓库骨架、pnpm、bundle 安装 |
| [phase-l1.md](phase-l1.md) | FleetService、默认 Provider、测试套件 |
| [phase-l2.md](phase-l2.md) | `fleet_*` 工具 Consumer、模型输出和真实 ToolRuntime 验收 |

后继阶段（L3+）有代码需求时再单开一页，不要提前写实现规格。

## 推进规则

1. 上一层没有验收通过，不开始下一层。
2. 实现只依赖 [architecture.md](../architecture.md) 列出的公开缝。
3. 包管理只用 **pnpm**。
4. 运行时钉 `@deepseek-ai/dsh@0.1.0-rc.6`；源码 checkout 仅作阅读参考。
