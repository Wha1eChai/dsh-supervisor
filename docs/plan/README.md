# 计划组

本目录只写**尚未完成或按阶段切开的工作**。产品边界见 [../product.md](../product.md)，挂载方式见 [../architecture.md](../architecture.md)。

## 当前状态

**L2 已完成**：独立 `@wha1echai/dsh-supervisor/tool` Consumer 为同一运行中 DSH runtime 的 live Session 提供安全分级的 `fleet_*` 模型工具，并通过真实 ToolRuntime 与构建产物 Loader composition 测试。

下一项 correctness priority 是以 `ctx.agents.roots()` 判断 authoritative runtime roots；当前 lineage 元数据分类仍可能误判。Delegated child 写入、主管 Agent、跨进程/远程 transport、Web 产品面、Electron、daemon 和多 runtime control 都还没开始。下一项能力变更应单独定义阶段范围。

## 文档

| 文件 | 内容 |
|---|---|
| [decisions.md](decisions.md) | 已锁定、实现不得推翻的决定 |
| [layers.md](layers.md) | L0–L6 全景和依赖 |
| [phase-l0.md](phase-l0.md) | 仓库骨架、pnpm、bundle 安装 |
| [phase-l1.md](phase-l1.md) | FleetService、当前同进程 Provider、测试套件 |
| [phase-l2.md](phase-l2.md) | `fleet_*` 工具 Consumer、模型输出和真实 ToolRuntime 验收 |

后继阶段（L3+）有代码需求时再单开一页，不要提前写实现规格。

## 推进规则

1. 上一层没有验收通过，不开始下一层。
2. 实现只依赖 [architecture.md](../architecture.md) 列出的公开缝。
3. 包管理只用 **pnpm**。
4. 运行时钉 `@deepseek-ai/dsh@0.1.0-rc.6`；源码 checkout 仅作阅读参考。
