# L2.4 — Attributed Fleet relay

**状态：已完成。** 本阶段只给 confirmed-target 的 selected `send` / `steer` 增加 Provider 生成的、可持久化的 relay attribution；direct Service API 保持兼容的 plugin attribution。

## Relay source

`src/relay.ts` 声明 rc.6 `MessageSourceMap` 的 merge-extensible `fleet-relay` source：

```ts
{
  kind: 'fleet-relay'
  version: 1
  form: 'relay'
  senderSessionId: SessionId
  deliveryId: FleetDeliveryId
}
```

`senderSessionId` 只从 selection 中保存的 exact caller Agent 的 Session 派生。工具 schema、direct `callerSessionId` 字符串、target reference、selection handle、标题和正文都不能提供或覆盖 sender。`deliveryId` 是 Provider 生成的 opaque branded identity，既用于 durable source，也用于 selected write receipt；它只用于 correlation 和 observability，不用于授权。

Direct `send` / `steer` 继续使用：

```ts
{ kind: 'plugin', plugin: 'dsh-supervisor' }
```

没有 exact owning Agent 的 direct compatibility lane 不会被字符串 caller 身份伪装成 relay。没有新增 direct attributed overload。

## Model-visible envelope

Provider 从同一组 canonical facts 生成模型可见正文：

```text
Fleet relay from session <encoded sender>:
[untrusted body begins]
<original body>
```

sender 使用 URI 编码，正文作为独立 text block 原样保留，不 trim、不折叠空白、不从正文反解析身份或 correlation。正文中的 forged sender、header、delimiter、target 或 handle 都只是 untrusted model input。Envelope 只有展示作用；结构化 source 和 exact Agent state 才是权威事实。

## Delivery receipt and inspect

Selected `send` / `steer` 返回：

```ts
{
  sessionId: string
  messageId: string
  deliveryId: FleetDeliveryId
}
```

`sessionId` 与 `messageId` 继续来自 exact target 和 created `UserMessage`。Receipt 只表示 `followup()` 或 `steer()` 同步接受进入 Agent inbox，不表示 claim、turn 完成或 assistant reply；steer 也不获得独立的 reply 语义。

Inspect 只在消息 source 精确匹配 `fleet-relay` 时投影窄 `relay` 字段，包含 version、form、senderSessionId 和 deliveryId。它不投影 target reference、selection handle、标题、Agent 对象或 raw source。正文摘要保留实际 model-visible 文本，不通过解析 header 去除 body。

完整 relay 已包含在现有 `user/message` durability 中，不新增 Fleet Session event，也不修改 Session format version。Provider 不持久化 target reference 或 selection handle；它们只存在于 transient Provider state 和既有工具调用参数记录中。

## Confirmed write invariants

L2.2 的 target reference、exact-Agent selection、byte-exact handle、single-attempt consumption、expiry、replacement/disposal/unload invalidation、self restriction、delegated write deferral 和 fail-closed metadata 保持不变。Relay source 不扩大目标授权，也不允许 target substitution。

Selected send 和 selected steer 共享 relay attribution，因为 `form: 'relay'` 只表示 caller Agent addressed the target Agent。两者的 follow-up/steer inbox scheduling 差异由 Agent API 保持，不写入 source，也不宣称 reply/result 归属。

## 验收

- Provider tests cover exact caller attribution, direct compatibility attribution, forged body text, delimiter injection, encoded sender, whitespace preservation, delivery correlation, inspect projection, replacement, duplicate use and unload.
- ToolRuntime tests cover closed output schemas, model-supplied identity fields being ignored, canonical delivery receipts, render output, agentless execution and abort behavior.
- Real Loader composition covers two live Agents, selected send, durable message source, inspect projection and absence of capability handles in relay data.
- Namespace entries remain named-export only and direct rc.6 peers remain exact versions.

## 不做

- wait/jobs、approval、ACL、broadcast、full inbox、search、cost/health、UI、transport、delegated writes、workflow 或 subagent behavior。
- Fleet 专用 reply/result correlation、assistant-output attribution、异步 settlement 或 `whenIdle()` 等待。
