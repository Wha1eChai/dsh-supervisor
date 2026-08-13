# 已锁定决定

实现和评审以本页为准。要改其中任何一条，先改文档再改代码。

## 产品

1. 本仓库是 **DSH 外部插件**，不是第二个 harness，也不往 `deepseek-ai/deepseek-harness` 提 PR。
2. 包名 `@wha1echai/dsh-supervisor`。禁止发布或伪装 `@deepseek-ai/*`。
3. 用户感知是：安装官方 `dsh`，再 `dsh plugin add` 本包。
4. Electron / EXE 若出现，只是调起并连接 `dsh` 的壳。

## 哲学

5. 能力必须是完整 **capability seam**：Service Definition + 可替换 Provider + Consumer。禁止在工具里直接 `ctx.agents.get(id).followup(...)`。
6. 子 Session 的继续写入、中断、子树枚举属于 **`ctx.subagents`**。Fleet 不复制这条缝。
7. 模型脚本扇出属于 **`ctx.workflowEngine`**。Fleet 不做第三个调度器。
8. `ctx.subagents` / `ctx.workflowEngine` 对 Fleet 是可选依赖。没有 subagent 缝时，child 只读，禁止对 child 调 `Agent.followup`。
9. Fleet Provider 留在 **host 平面**，不放进 agent-preset isolate realm（与官方把 `subagents` 留在 host 同一理由）。
10. 本插件不持有 `AgentHandle.dispose`。

## 第一阶段范围

11. 调试宿主：现有 **`web` profile**。独立 `supervisor` profile 是 L4。
12. `list()` 只包含 **当前进程 live Agent**。cold Session 不出现。
13. live root：`list` / `inspect` / `send` / `steer` / `cancel`。
14. live child：L1 必须标成 `kind: 'delegated'`。写入返回明确错误（`delegated-write-deferred` 或缺少缝时的 `observe-only`），L2 再接 `subagents.followup` / `interrupt`。
15. 传入 `callerSessionId` 时禁止控制自己。
16. 取消原因：`{ kind: 'hook', reason: 'fleet-cancel' }`。
17. 发送/转向来源：`{ kind: 'plugin', plugin: 'dsh-supervisor' }`。
18. patch **只 insert** 自己的 row，不整行替换官方 bundle config。

## 工程

19. 包管理：**pnpm**。不要提交 npm / yarn lockfile。
20. 模块：**ESM**（`"type": "module"`）。
21. 运行时钉 **`@deepseek-ai/dsh@0.1.0-rc.6`** 所携带的公开包版本；直接 import 的 DSH peer 使用精确 `0.1.0-rc.6`，不使用会跨到稳定版的 `^0.1.0-rc.6`。
22. 接受配置的插件导出同名 TypeScript `Config` 与 Schemastery schema；deployment-varying 默认值不得藏在方法里。
23. Git/GitHub 源安装必须有 `prepare` 从源码构建；registry/tarball 分发携带构建产物。
24. 测试默认 **keyless**：mock `ctx.agents` / `Agent`。不把需要 `DEEPSEEK_API_KEY` 的 e2e 当作 L1 门禁。
25. 代码、标识符、commit message 用英文；用户文档用中文。
