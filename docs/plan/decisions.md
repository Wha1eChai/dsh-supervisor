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

22. `sessionId` 是当前 DSH runtime 内稳定、第一等的 Fleet 路由标识，可信程序化 Consumer 的直接 Service API 继续使用它。
23. 模型工具禁止在 inspect/write 之间重复提交 `sessionId`：`fleet_list` 返回 caller-bound `targetRef`，`fleet_inspect` 接受 `target_ref` 并签发 exact-Agent-bound `selectionHandle`，send/steer/cancel 只接受 `selection_handle`。
24. `targetRef` 与 `selectionHandle` 同时绑定 exact caller Agent、exact target Agent、Provider instance 和 expiry；caller mismatch、disposal、同 ID replacement、unload、expiry 或已消费都 fail closed，禁止解析或回退为其他 Session。
25. Selection 固定为 single-attempt。所有输入与授权检查通过后，在 Agent 副作用前消费；Agent 方法异常和 ToolRuntime late abort 都不恢复。
26. Self/delegated target 可以 inspect，但不签发 selection；delegated 写仍属于 L2b。
27. 未来任何 Session-list UI 必须展示 `sessionId` 并提供复制操作；当前没有该 UI。
28. 当前 `sessionId` 不是已定义的全局或跨 runtime remote address。未来多 runtime 支持必须另行设计 runtime namespace 和寻址。
29. `list()` 只包含当前 DSH runtime，也就是当前 `dsh` 进程中的 live Agent。cold Session 不出现。
30. live root 目标行为：直接 API 支持 `list` / `inspect` / `send` / `steer` / `cancel`；模型工具使用 confirmed-target lane。
31. runtime root membership 的唯一权威来源是 exact Agent 对象是否属于 `ctx.agents.roots()`。属于 roots 为 `root`，不属于为 `delegated`；`list`、`inspect`、`rootsOnly`、写授权和 lifecycle event 必须使用同一分类。
32. `session.header.origin` 与 `session.header.parentSession` 只属于 durable Session metadata，不参与 runtime `kind`、`control`、`rootsOnly` 或写授权。`parentSession` 始终独立投影为 `parentSessionId`，所以 runtime root 可以带 lineage，runtime delegated Agent 也可以没有 lineage。
33. runtime delegated Agent 保持 deferred / observe-only：有 subagent seam 时写入返回 `fleet-delegated-write-deferred`，缺少 seam 时返回 `fleet-observe-only`；通过 `subagents.followup` / `interrupt` 写入属于 L2b。
34. `agent/disposed` 在 registry 删除后发出；Fleet 必须按 exact Agent 对象缓存 runtime classification，禁止在 disposal 路径读取 roots、按 id 查询当前 Agent、调用 `isOwnedBy` 或回退到 lineage。Provider 挂载时先监听 lifecycle，再 seed 已经 live 的 Agent。
35. 传入 `callerSessionId` 时禁止控制自己。
36. 取消原因：`{ kind: 'hook', reason: 'fleet-cancel' }`。
37. 发送/转向来源按调用车道区分：可信程序化 direct `send` / `steer` 保持 `{ kind: 'plugin', plugin: 'dsh-supervisor' }`；confirmed-target 模型 `sendSelected` / `steerSelected` 使用版本化 `fleet-relay` source。Confirmed-target 的 list/inspect/write lane 必须携带 ToolRuntime 提供的 exact caller Agent；Provider 将该 exact object 绑定到 transient target/selection state，并只从它派生 `senderSessionId`。`callerSessionId` 只是同一 exact object 的一致性校验，不能单独授予归因。Provider 同时生成 opaque `deliveryId` 并将其写入 source、model-visible header 和 delivery receipt；固定 marker 之后的 body 从独立 text block 开始并保持 untrusted。Relay attribution 不扩大写授权，不能由工具 schema、direct caller 字符串、标题或正文覆盖。`target_ref` / `selection_handle` 不出现在 relay source、body、receipt 或 inspect projection 中，也不进入 transient Provider relay state；正常 DSH tool/call audit 仍保留工具 arguments。
38. patch **只 insert** 自己的 row，不整行替换官方 bundle config。

## 工程

39. 包管理：**pnpm**。不要提交 npm / yarn lockfile。
40. 模块：**ESM**（`"type": "module"`）。
41. 运行时钉 **`@deepseek-ai/dsh@0.1.0-rc.6`** 所携带的公开包版本；直接 import 的 DSH peer 使用精确 `0.1.0-rc.6`，不使用会跨到稳定版的 `^0.1.0-rc.6`。
42. 接受配置的插件导出同名 TypeScript `Config` 与 Schemastery schema；deployment-varying 默认值不得藏在方法里。
43. Git/GitHub 源安装必须有 `prepare` 从源码构建；registry/tarball 分发携带构建产物。
44. 测试默认 **keyless**：mock `ctx.agents` / `Agent`。不把需要 `DEEPSEEK_API_KEY` 的 e2e 当作 L1 门禁。
45. 代码、标识符、commit message 用英文；用户文档用中文。
46. L2 工具是独立 `./tool` Consumer，只依赖 `ctx.fleet` / `ctx.tools`；不读取 `ctx.agents`、`ctx.subagents` 或 `ctx.workflowEngine`。
47. 工具默认 `controlMode: 'read-only'`；`message` 才暴露 send/steer，`full` 才暴露 cancel。模型不能传 `callerSessionId`。
48. Delegated child followup / interrupt 需要 subagent seam 的精确 parent authority，属于后续 L2b Service API 设计，不由 L2 Consumer 绕过。
49. L2.3 的 title discovery 只能通过可选 `ctx.sessionTitle.get(exactLiveSession)` 读取已有 `session/title`；不得调用 `refresh`、生成标题、注册 Provider 或依赖 LLM。服务缺失或卸载时 Fleet 必须继续可用并省略 `title`。
50. Title 只是展示投影，不能参与 Session identity、routing、target reference、selection、排序、过滤、runtime ownership 或授权，也不能扩大 live Agent corpus。
51. Inspect 必须先过滤 user/assistant 候选，再分别记录 tail omission 的 `omittedMessages` 和每条摘要的 `textTruncated`；tool、reasoning 与其他消息角色不计入 omission。
