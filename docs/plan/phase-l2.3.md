# L2.3 — Title-rich discovery and inspect fidelity

**状态：已完成。** 本阶段增强 Fleet 的展示投影，不改变 live Agent 范围、目标确认协议或写授权。

## 目标

Fleet Agent view 在可用时提供 exact live Session 日志中已有的 `session/title`，并让 inspect 明确区分 tail omission 与每条消息文本截断。

## Title projection

Provider 通过可选的 `ctx.sessionTitle` 服务调用 `get(agent.session)`。读取使用当前 exact `Session` 对象，不按 `sessionId` 查找，不调用 `refresh`、`register`、标题 Provider 或 LLM。

服务缺失、卸载或日志中没有已记录标题时，省略 `title` 字段，Fleet 仍可 list、inspect 和使用既有目标确认协议。服务重新加载后，同一日志中的已记录标题可以再次出现。

标题是展示数据，不参与 Session identity、routing、target reference、selection、list 顺序、过滤、runtime ownership 或授权。

## Inspect output

`FleetInspectView.omittedMessages` 统计过滤出 user/assistant 后，因 tail limit 没有返回的候选消息数量。tool、reasoning 和其他消息角色不计入该数量。

`FleetMessageSummary.textTruncated` 在文本截断前计算，只表示当前消息原始文本超过 `maxMessageTextChars`。它与 `omittedMessages` 独立；没有 omission 时仍可能出现文本截断，存在 omission 时保留消息也可能没有文本截断。

## Composition

`@deepseek-ai/dsh-session-title` 是 `0.1.0-rc.6` optional peer/dev dependency。Cross-session plugin 不把它加入 Bundle patch，也不把它作为 Provider 的 required injection。主入口与 `./tool` 继续使用 Loader-safe named exports。

## 验收

- title service 不存在时 Fleet list/inspect 正常，且不输出 `title`。
- Fleet 只读取 exact Session 的已有 title，不触发 `refresh`、`register`、Provider 或 LLM。
- title service unload/reload 不影响 Fleet，并能从同一日志恢复 title。
- inspect 精确报告候选 omission 与每条消息的 text truncation，结果保持 JSON-safe。
- tool schema、canonical value 和 render 包含新增字段，`presentCall` 仍为纯函数。
- 官方 Loader 可加载带或不带 title service 的 composition；Consumer、Provider 和工具卸载仍遵守既有生命周期规则。
- 直接 Service API、confirmed-target handles、Session ID 顺序和写授权不受 title 影响。

## 不做

- 不生成、刷新、重命名或搜索标题。
- 不扩大 live Agent corpus，不读取 `sessionQuery`，不建立 title index。
- 不增加健康、摘要、用途、成本、搜索或批量控制字段。
- 不实现 delegated writes、transport、remote Web、UI、daemon 或 multi-runtime。
