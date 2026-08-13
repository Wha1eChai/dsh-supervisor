# 已锁定决定

实现和评审以本页为准。要改其中任何一条，先改文档再改代码。

## 产品

1. 本仓库是 **DSH 外部插件**，不是第二个 harness，也不往 `deepseek-ai/deepseek-harness` 提 PR。
2. 包名 `@wha1echai/dsh-supervisor`。禁止发布或伪装 `@deepseek-ai/*`。
3. 用户感知是：安装官方 `dsh`，再 `dsh plugin add` 本包。
4. 当前产品优先级是同一运行中 DSH runtime（一个 `dsh` 进程）内 live Session 之间的发现、寻址和通信。
5. 当前产品面是 Fleet Service/API 和模型可调用的 `fleet_*` 工具，不是多 Session UI 或远程控制服务。
6. Web 可作为未来一等产品面，Electron / EXE 可作为可选 wrapper；二者都次于当前同 runtime 通信目标，当前均未提供。
7. 当前明确不支持跨进程、跨终端或跨设备、本地到服务器、remote Web、gateway、daemon 或多 runtime 聚合控制。
8. `web` profile 只是当前安装和调试宿主，不表示本插件提供 remote Web 或 supervisor UI。

## 哲学与能力组合

9. 能力必须是完整 **capability seam**：Service Definition + 可替换 Provider + Consumer。禁止在工具里直接 `ctx.agents.get(id).followup(...)`。
10. 子 Session 的继续写入、中断、子树枚举属于 **`ctx.subagents`**。Fleet 不复制这条 seam。
11. 模型脚本扇出属于 **`ctx.workflowEngine`**。Fleet 不做第三个调度器。
12. `ctx.subagents` / `ctx.workflowEngine` 对 Fleet 是可选依赖。没有 subagent seam 时，被识别为 child 的 Session 只读，禁止对其调用 `Agent.followup`。
13. Service 存在不等于模型工具存在。只有对应公开 seam 和 Consumer 都已挂载，模型才能看到 subagent 或 workflow 工具。
14. Fleet tool Consumer 只注册和描述 `fleet_*`；不得复制 subagent/workflow 工具、调用其实现或广告未挂载能力。
15. 未来 supervisor preset 只能条件组合实际存在的 public seam 和已挂载 Consumer。
16. Fleet Provider 留在 **host 平面**，不放进 agent-preset isolate realm。
17. 本插件不持有 `AgentHandle.dispose`。

## 工具发现

18. 模型可见能力由 profile/Consumer 组合和当前 tool registry 决定，不由注入 prompt 文本决定。
19. Consumer 在 Session 已经 live 后挂载或重配时，该 Session 在下一次模型请求中通过正常 ToolRuntime 组合看到最新工具集合。
20. 不注入 user、assistant 或其他聊天消息来通知能力出现。
21. 不添加只为广告能力存在而常驻的 system prompt prose。

## 身份与当前范围

22. `sessionId` 是当前 DSH runtime 内稳定、第一等的 Fleet 路由标识。
23. `fleet_list` 的 canonical output `{ agents, count }` 中，每个 Agent 视图必须包含 `sessionId`；inspect/send/steer/cancel 使用它寻址。
24. 未来任何 Session-list UI 必须展示 `sessionId` 并提供复制操作；当前没有该 UI。
25. 当前 `sessionId` 不是已定义的全局或跨 runtime remote address。未来多 runtime 支持必须另行设计 runtime namespace 和寻址。
26. `list()` 只包含当前 DSH runtime，也就是当前 `dsh` 进程中的 live Agent。cold Session 不出现。
27. live root 目标行为：`list` / `inspect` / `send` / `steer` / `cancel`。
28. runtime root membership 的目标权威来源是 `ctx.agents.roots()`。当前实现仍以 `origin` / `parentSession` lineage 元数据推断 root/delegated；这是未完成的 correctness priority，不得声称当前分类完全正确。
29. 当前被推断为 delegated 的 Session 保持 deferred / observe-only：有 subagent seam 时写入返回 `delegated-write-deferred`，缺少 seam 时返回 `observe-only`；通过 `subagents.followup` / `interrupt` 写入属于 L2b。
30. 传入 `callerSessionId` 时禁止控制自己。
31. 取消原因：`{ kind: 'hook', reason: 'fleet-cancel' }`。
32. 发送/转向来源：`{ kind: 'plugin', plugin: 'dsh-supervisor' }`。
33. patch **只 insert** 自己的 row，不整行替换官方 bundle config。

## 工程

34. 包管理：**pnpm**。不要提交 npm / yarn lockfile。
35. 模块：**ESM**（`"type": "module"`）。
36. 运行时钉 **`@deepseek-ai/dsh@0.1.0-rc.6`** 所携带的公开包版本；直接 import 的 DSH peer 使用精确 `0.1.0-rc.6`，不使用会跨到稳定版的 `^0.1.0-rc.6`。
37. 接受配置的插件导出同名 TypeScript `Config` 与 Schemastery schema；deployment-varying 默认值不得藏在方法里。
38. Git/GitHub 源安装必须有 `prepare` 从源码构建；registry/tarball 分发携带构建产物。
39. 测试默认 **keyless**：mock `ctx.agents` / `Agent`。不把需要 `DEEPSEEK_API_KEY` 的 e2e 当作 L1 门禁。
40. 代码、标识符、commit message 用英文；用户文档用中文。
41. L2 工具是独立 `./tool` Consumer，只依赖 `ctx.fleet` / `ctx.tools`；不读取 `ctx.agents`、`ctx.subagents` 或 `ctx.workflowEngine`。
42. 工具默认 `controlMode: 'read-only'`；`message` 才暴露 send/steer，`full` 才暴露 cancel。模型不能传 `callerSessionId`。
43. Delegated child followup / interrupt 需要 subagent seam 的精确 parent authority，属于后续 L2b Service API 设计，不由 L2 Consumer 绕过。
