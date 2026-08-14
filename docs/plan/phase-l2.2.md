# L2.2 — Confirmed Fleet target writes

**状态：已完成。** 本阶段把模型工具的目标选择改为 Provider 强制确认，不改变可信程序化 Consumer 使用的直接 `sessionId` Service API。Keyless 门禁和同一 Web runtime 的双 Session 真实消息验收均已通过。

## 目标

模型不再在 `fleet_list`、`fleet_inspect` 和写工具之间重复生成长 opaque `sessionId`。官方工具使用两级短期能力：

```text
fleet_list
  -> caller-bound target_ref
fleet_inspect(target_ref)
  -> exact-Agent-bound selection_handle
fleet_send / fleet_steer / fleet_cancel(selection_handle)
```

Handle 按 byte-exact opaque value 验证，不做 trim 或其他规范化；损坏、带首尾空白、过期或被其他 caller 使用的 handle 只会失效，不会解析或回退为其他 Session。

## Service lane

现有直接 API 保留给可信程序化 Consumer：

```ts
list(filter?)
inspect(sessionId, options?)
send(sessionId, text, options?)
steer(sessionId, text, options?)
cancel(sessionId, options?)
```

模型工具只使用 confirmed-target lane：

```ts
listTargets(options) -> FleetTargetView[]
inspectTarget(targetRef, options) -> FleetTargetInspectView
sendSelected(selectionHandle, text, options)
steerSelected(selectionHandle, text, options)
cancelSelected(selectionHandle, options)
```

Consumer 仍只依赖 `ctx.fleet`。只有 Provider 持有 exact Agent identity、target reference 和 selection record。

## Handle authority

`target_ref` 和 `selection_handle` 都绑定：

- owning caller 的 exact Agent 对象与 `callerSessionId`；确认 lane 的 Service options 必须同时携带 exact Agent，字符串 id 只作一致性校验；
- target 的 exact Agent 对象与原始 `sessionId`；
- 当前 Provider 实例；
- expiry。

使用时重新检查 `ctx.agents.get(id) === exactAgent`。因此 caller 或 target 的同 ID replacement、disposal、Provider unload 和 expiry 都会 fail closed。

Target reference 可在同一 caller/target/TTL 窗口复用。Selection 每次 inspect 单独签发，固定为 single-attempt：所有输入、caller、target 和当前写授权检查通过后，在调用 Agent 副作用前消费。Agent 方法随后抛错或 ToolRuntime late abort 都不恢复 selection。

Self target 和 runtime delegated target 可以 inspect，但不会收到 selection。Delegated 写路径仍属于后续 L2b。

## 工具 hard cut

模型工具不保留 direct `session_id` fallback：

| 工具 | 参数 | 结果 |
|---|---|---|
| `fleet_list` | `roots_only?`, `running_only?` | `{ agents: FleetTargetView[], count }` |
| `fleet_inspect` | `target_ref`, `tail_messages?` | `{ agent: FleetInspectView, selection? }` |
| `fleet_send` | `selection_handle`, `text` | `{ sessionId, messageId, deliveryId }` |
| `fleet_steer` | `selection_handle`, `text` | `{ sessionId, messageId, deliveryId }` |

| `fleet_cancel` | `selection_handle`, `keep_inbox?` | `{ sessionId, accepted: true }` |

L2.4 augments both selected-write outputs with the Provider-generated opaque `deliveryId`; see [phase-l2.4.md](phase-l2.4.md).

五个工具都要求 owning Agent，并只从 `exec.agent.session.id` 派生 caller。List/inspect 保持 parallel；write 保持 exclusive。

成功写结果中的 `sessionId` 由 Provider 返回，Consumer 不从 handle 或模型输入推断目标。

## 配置

Provider 增加正安全整数配置：

```ts
targetRefTtlMs: 300_000
selectionTtlMs: 60_000
maxSelectionsPerCaller: 32
```

Expiry 使用 lazy prune，不增加后台 timer。每 caller selection 超限时按插入顺序淘汰最旧记录。

## Fail closed

稳定新增错误码：

```text
fleet-caller-unavailable
fleet-target-reference-invalid
fleet-selection-invalid
```

`FleetError` 继承 DSH `HarnessError`，所以 ToolRuntime 保留 `{ name, code }`。每个 Fleet failure 同时携带：

```json
{
  "actionTaken": false,
  "targetSubstitutionAllowed": false,
  "nextAction": "relist-or-ask-user"
}
```

无效 reference/selection 的 model-facing error 明确说明：

```text
No action was taken. Do not substitute another Fleet session. Relist or ask the user.
```

## 验收

Keyless tests 覆盖：

- caller-bound target reference 和 exact-target selection；
- self/delegated inspect 不签发 selection；
- caller mismatch 后提交的 handle 失效；
- caller/target exact-object replacement；
- expiry 边界；
- selection double use；
- invalid text 不消费；
- Agent method throw 前已消费；
- 每 caller selection 上限；
- Provider unload 后 retained Service fail closed；
- ToolRuntime schema hard cut、caller identity、abort 和 structured Fleet error；
- built Loader composition 通过 owning Agent 调用真实 `fleet_list`；
- 同一 Web runtime 中，发送 Session 通过 `fleet_list` 返回的 byte-exact `target_ref` inspect 目标，再使用该 inspect 签发的 byte-exact `selection_handle` 调用 `fleet_send`；写结果返回预期目标 `sessionId`，目标 Session 收到指定 follow-up。

## 不做

- delegated child followup / interrupt；
- transport、remote Web、Electron 或 multi-runtime；
- 从 handle 推导或泄露 Agent runtime object；
- 删除可信程序化 Consumer 的直接 `sessionId` API；
- npm publish 或 GitHub Release。
