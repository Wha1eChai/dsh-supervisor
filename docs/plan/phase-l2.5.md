# L2.5 — Correlated reply observation

**状态：已完成。** 本阶段给 selected `fleet_send` 增加 exact turn-level reply observation，并通过可选 Jobs Consumer 消除 inspect busy-poll；不改变 steer、cancel、delegated write 或跨 runtime 范围。

## Reply receipt

`sendSelected()` 在调用 exact target `Agent.followup()` 前创建 Provider-owned reply record，并在 receipt 中返回：

```ts
{
  sessionId: string
  messageId: string
  deliveryId: FleetDeliveryId
  replyReceipt: FleetReplyReceipt
  replyReceiptExpiresAt: number
}
```

`replyReceipt` 同时绑定 exact caller Agent、exact target Agent、原始 relay `messageId`、`deliveryId`、当前 Provider instance 和 expiry。它是 single-observer capability：第一次合法观察开始后不能再次观察；caller mismatch、expiry、Provider unload 或已消费均返回 `fleet-reply-invalid`，不会替换成其他 delivery。

Provider 在 caller 达到 `maxReplyRecordsPerCaller` 时以 `fleet-reply-capacity` 拒绝新 send，并且在 `followup()` 之前不调用 target。`followup()` 抛错时删除未发布 reply record；selected write selection 仍按 L2.2 single-attempt 语义消费。

## Exact turn correlation

Provider 只使用 rc.6 的公开事件：

```text
selected send
  -> exact UserMessage.id
  -> agent/inbox/claimed { exact Agent, exact message, turn }
  -> session/event user/message { same message.id }
  -> session/event assistant/message { same turn }
  -> session/event turn/end { same turn }
```

`waitForReply()` 返回 turn-level result，不声称 assistant output 只由这一条 message 因果产生。同一 turn 可能包含 pre-step context、其它 input 或多步工具循环；结果名称和文档只写“claimed turn”。

Provider 收集同 turn 的 text-bearing `assistant/message`，按 `maxReplyMessages` 保留尾部并按 `maxReplyTextChars` 截断每条文本。`omittedAssistantMessages` 与每条 `textTruncated` 独立。`turn/end` 结算时返回完整 `TurnEndReason` 和 `admitted`：后者表示原始 relay 是否进入 durable `user/message` surface；pre-step rejection 可以产生 `admitted: false` 的 closed turn。

不使用 `Agent.status`、`whenIdle()`、`updatedAt` 或轮询作为 reply proof。Selected steer 不返回 reply receipt，也不复用 send 的独立-turn语义。

## Terminal outcomes

```ts
outcome: 'turn-ended' | 'discarded' | 'target-unavailable'
```

- `turn-ended`：exact claimed turn 已出现 `turn/end`；可能没有 assistant text。
- `discarded`：message 在 claim 前离开 inbox；没有 target turn。
- `target-unavailable`：exact target 在 terminal result 前 dispose/replacement；若已 claim，保留 `turn` 和 `admitted` 事实。

回复在 `waitForReply()` 注册前完成时短期保留，合法 caller 之后仍可一次读取。Caller disposal 使等待失败；Provider unload 拒绝所有 active waiters。Abort 只结束当前 observation 并释放记录，不 cancel、steer 或修改 target。

## Optional Jobs Consumer

独立 `@wha1echai/dsh-supervisor/reply-job` 入口只注入 `tools` 与 `fleet`，并通过 `ctx.inject(['jobs'], ...)` 条件注册 `fleet_wait`：

```text
fleet_wait(reply_receipt)
  -> { jobId }
```

该 Consumer 仅调用 `ctx.jobs.start()` 生产 owner-scoped `fleet-reply` final-output job，并用 `maxOutputBytes`（默认 300000）设置官方 Jobs Consumer 的完整输出上限；它不注册 `job_output`、`job_list`、`job_kill`，不 attach controller，也不发送 completion notice。官方 `@deepseek-ai/dsh-tool-jobs` 继续独占这些职责。没有 `ctx.jobs` 时 `fleet_wait` 不注册。

Job kill abort reply observation；它不取消 target Agent。Job output 是 `FleetReplyResult` 的 JSON 文本，官方 job tools 负责 bounded read、wait、ownership、kill 和 completion wake policy。

## 配置

```yaml
replyReceiptTtlMs: 600000
maxReplyRecordsPerCaller: 32
maxReplyMessages: 8
maxReplyTextChars: 8000
```

Expiry 采用 lazy prune；active observer 不因 TTL 到期被后台 timer 中断。TTL 限制开始观察和未消费 completed result 的保留期，不是 target execution timeout。

## 验收

- 精确 message claim、multi-step assistant、turn end、pre-step rejection、discard 和 completion-before-wait。
- caller mismatch、single observer、capacity、abort、caller/target disposal、Provider unload 和 same-id replacement。
- reply 文本数量/字符 bounds 和完整 `TurnEndReason`。
- `fleet_wait` 只在 Jobs seam 可用时注册，创建 owner-scoped `fleet-reply` job，kill 只 abort observation。
- built root、`./tool`、`./reply-job` namespace entries 无 `default` export；真实 Loader composition 覆盖 optional Jobs Consumer。

## 不做

- selected steer reply、strict message-to-message causal attribution、timeout-as-target-cancel、persistent offline inbox、broadcast、ACL/approval、search、health/cost、UI、transport、delegated writes、workflow/subagent duplication。
