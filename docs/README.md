# 文档路由

本目录是 `dsh-supervisor` 的文档入口。先读本页，再按问题进对应文档组。事实只在一处写全，其他文档用链接引用。

## 文档组

| 组 | 入口 | 回答的问题 |
|---|---|---|
| 产品 | [product.md](product.md) | 这是什么、不是什么、给谁用、怎么分发 |
| 架构 | [architecture.md](architecture.md) | 如何挂在 DSH 上、公开 seam、同 runtime 边界和工具发现 |
| 计划 | [plan/README.md](plan/README.md) | 分层、已做决定、每阶段范围和验收 |
| 参考 | [reference/fleet.md](reference/fleet.md) | Fleet API、错误码、配置字段 |

尚未开始的阶段不要在产品/架构文档里展开实现细节；那些内容只放在计划组对应阶段页。

## 阅读顺序

1. [product.md](product.md) — 产品边界。
2. [architecture.md](architecture.md) — 挂载方式和禁止依赖。
3. [plan/decisions.md](plan/decisions.md) — 已锁定决定。
4. [plan/layers.md](plan/layers.md) — 已交付 L0–L2.2 和未来 L2b–L6 全景。
5. 当前实现阶段：[plan/phase-l0.md](plan/phase-l0.md)、[plan/phase-l1.md](plan/phase-l1.md)、[plan/phase-l2.md](plan/phase-l2.md)、[plan/phase-l2.1.md](plan/phase-l2.1.md)、[plan/phase-l2.2.md](plan/phase-l2.2.md)、[plan/phase-l2.3.md](plan/phase-l2.3.md)。

## 仓库内其他入口

| 文件 | 职责 |
|---|---|
| [../README.md](../README.md) / [../README.zh.md](../README.zh.md) | 公开仓库说明、安装、状态和 TODO |
| [../AGENTS.md](../AGENTS.md) | 在本仓库改代码时的实现约束 |

## 写作约定

- 中文正文，英文标识符。
- 写当前约定，不写讨论过程。
- 一段一事，一段一行。
- 计划组可以写未实现工作；产品/架构组只写已采纳的边界。
