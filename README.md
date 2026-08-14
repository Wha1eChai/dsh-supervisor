# dsh-supervisor

English | [中文](README.zh.md)

A community plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) focused on cross-Session discovery, addressing, and communication among live Sessions in the same running DSH runtime (one `dsh` process). It exposes a replaceable `ctx.fleet` service plus model-callable `fleet_*` tools over that service.

> **Status: tool preview (L0 + L1 + L2 + L2.1 + L2.2 + L2.3).** Fleet now includes optional log-backed title projection and lossless inspect truncation facts. The Fleet service, authoritative runtime-ownership classification, and five tool Consumer definitions are implemented and keylessly tested through the built package entries. The current product surface is an API and model tools, not a multi-Session UI or remote control service.

This is an independent community project and is not affiliated with or endorsed by DeepSeek AI.

## Design

DeepSeek Harness treats capabilities as hot-swappable plugin seams. `dsh-supervisor` follows the same structure:

```text
FleetService                  Service Definition (`ctx.fleet`)
InProcessFleetProvider        Same-process Provider (`ctx.agents`)
fleet_* tools                 Current Consumer (`ctx.fleet` + `ctx.tools`)
supervisor preset             Planned Consumer (L3)
profile / surface / transport Future Consumers (L4+)
```

The Fleet tool Consumer never imports the Agent or Subagent APIs and does not access `ctx.agents`, `ctx.sessions`, or `ctx.subagents`. It registers only `fleet_*` tools. The plugin does not replace or duplicate the existing subagent or workflow capabilities:

- delegated-Session continuation and interruption belong to the public `ctx.subagents` seam and its official Consumer;
- orchestration belongs to the public `ctx.workflowEngine` seam and its official Consumer;
- Fleet adds a same-process view of live Sessions and limited root-Session control.

Subagent and workflow tools are optional profile composition. They are model-visible only when their corresponding public seam and Consumer are mounted; Fleet does not advertise unavailable capabilities.

See [docs/architecture.md](docs/architecture.md) for the complete constraints.

## Current capabilities

`ctx.fleet` provides:

- `list()` — list live Agents in the current DSH process;
- `inspect()` — return a bounded, JSON-safe transcript summary;
- `send()` — enqueue a plugin-sourced follow-up for a live root Agent;
- `steer()` — steer a live root Agent;
- `cancel()` — cancel a live root Agent with a stable Fleet cause;
- `subscribe()` — observe projected create/status/dispose events.

The separate `@wha1echai/dsh-supervisor/tool` entry registers:

- `fleet_list` and `fleet_inspect` in every mode;
- `fleet_send` and `fleet_steer` in `message` and `full` modes;
- `fleet_cancel` only in `full` mode.

Mounting this Consumer makes its currently configured tools available to already-live Sessions through normal ToolRuntime composition on their next model request. It does not inject a synthetic chat message or rely on permanent system-prompt prose to announce Fleet.

The direct Service API keeps `sessionId` as the stable routing identifier for trusted programmatic Consumers. Model tools use a confirmed-target protocol instead: `fleet_list` returns a caller-bound `targetRef`, `fleet_inspect` accepts that reference and may issue an exact-Agent-bound single-attempt `selectionHandle`, and write tools accept only the selection. Invalid, expired, mismatched, replaced, unloaded, or already-used handles fail closed and never authorize substituting another Session. Every Agent view still includes `sessionId`; any future Session-list UI must display it and provide a copy action.

The default `controlMode` is `read-only`. All five confirmed-target tools derive caller identity only from their owning Agent Session and reject agentless execution; write authorization remains in `ctx.fleet`. Fleet classifies runtime roots by exact Agent membership in `ctx.agents.roots()`; durable `origin` and `parentSession` metadata do not affect `kind` or write authority. Delegated Agents remain read-only in L2.1; the Consumer never bypasses Fleet to call subagent APIs directly.

When the optional `sessionTitle` service is mounted, Fleet reads only an already logged title from the exact live Session and exposes it as a display field in list/inspect projections. Missing or unloaded title service leaves Fleet available without `title`; title never affects identity, routing, selection, ordering, filtering, or authorization. Inspect separately reports messages omitted by the tail limit and per-message `textTruncated` facts.

API, configuration, tools, and error codes are documented in [docs/reference/fleet.md](docs/reference/fleet.md).

## Current scope

The in-process Provider sees live Sessions only in the same running DSH runtime, meaning the same `dsh` process. The current release does not provide:

- cross-process or multi-runtime discovery and control;
- cross-terminal or cross-device routing;
- local-to-server control;
- remote Web, gateway, or daemon support;
- a multi-Session Web or desktop UI.

The `web` profile used below is an existing DSH host for installation and development. It does not mean that this plugin supplies remote Web support or a supervisor UI. Web may become a future first-class surface, with Electron as an optional wrapper, but both remain secondary to same-runtime communication.

## Requirements

- Node.js `^22.19.0` or `>=24.0.0`
- pnpm `11.7.0` for repository development
- `@deepseek-ai/dsh@0.1.0-rc.6`

The first release line intentionally makes no compatibility promise across DSH release candidates.

## Install

No npm release is published yet. Use a local checkout or a commit-pinned GitHub source installation.

### Local checkout

```sh
git clone https://github.com/Wha1eChai/dsh-supervisor.git
cd dsh-supervisor
pnpm install
pnpm run build

dsh plugin --profile web add /absolute/path/to/dsh-supervisor
dsh --profile web --dump-config
dsh --profile web
```

On PowerShell, use an isolated development home instead of changing an existing user profile:

```powershell
$env:DSH_HOME = "D:\coding\programs\dsh\.dsh-supervisor-home"
dsh plugin --profile web add D:\coding\programs\dsh\dsh-supervisor
dsh --profile web --dump-config
dsh --profile web
```

### GitHub source

Pin a reviewed commit:

```sh
dsh plugin --profile web add github:Wha1eChai/dsh-supervisor#<commit>
```

Git installs run the package's `prepare` script to build TypeScript. pnpm 10 and later reject that script until the user explicitly allows the package in the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@wha1echai/dsh-supervisor': true
```

Review the source and pin a commit before granting install-time execution permission. Re-run `dsh plugin add` after adding the allowance.

## Usage

The Bundle installs both package entries. Its safe default exposes only `fleet_list` and `fleet_inspect`. To enable message or cancellation tools, override the complete `dsh-supervisor-tools` row in the profile's `cordis.patch.yml`:

```yaml
- id: dsh-supervisor-tools
  name: '@wha1echai/dsh-supervisor/tool'
  config:
    controlMode: message # read-only | message | full
```

Use `full` only in a profile where model access to cancellation is intended. `controlMode` selects tool visibility; it does not replace `tools/pre-execute`, approval, or `ctx.tools.guard()` policy.

Other plugins may consume Fleet directly by declaring `fleet` as a required service:

```ts
export const inject = ['fleet']

export function apply(ctx: Context) {
  const live = ctx.fleet.list()
  // Build a future command or UI adapter from the same-runtime JSON-safe view.
}
```

Such Consumers are separate plugins and are not included with the current package. Any future transport or remote Consumer also requires separate identity, transport, and permission design; the current `sessionId` must not be treated as a global remote address.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack
```

The tests use the real `ToolRuntime`, validate canonical values and model-facing content, and boot a test-only `cordis.yml` through the official Loader + Include path using both built package entries. They also guard both namespace entries against a `default` export and verify Provider/Consumer unload behavior.

## Roadmap / TODO

- [x] **L0** — installable Bundle, build, package metadata, real Loader smoke.
- [x] **L1** — `FleetService`, in-process Provider, lifecycle isolation, keyless tests.
- [x] **L2** — `fleet_list`, `fleet_inspect`, `fleet_send`, `fleet_steer`, and `fleet_cancel` tool Consumer.
- [x] **L2.1** — authoritative runtime root/delegated classification through exact Agent membership in `ctx.agents.roots()`, independent of durable lineage metadata.
- [x] **L2.2** — caller-bound target references and exact-Agent-bound single-attempt selections for fail-closed model writes.
- [x] **L2.3** — optional log-backed title discovery and inspect omission/text-truncation fidelity.
- [ ] **L2b** — delegated-Session write API with exact parent authority through the public subagent seam.
- [ ] **L3** — supervisor Agent preset that conditionally composes the existing Fleet, subagent, and workflow Consumers.
- [ ] **L4+** — future dedicated profiles, first-class surfaces, and transports; none are current support.
- [ ] **L5 option** — optional Electron wrapper around a future supported surface.
- [ ] **L6+** — future daemon and multi-runtime Fleet Providers.
- [ ] Publish the first registry package after user-facing verification.
- [ ] Add compatibility CI for each supported DSH release candidate.

Detailed phase boundaries are in [docs/plan/layers.md](docs/plan/layers.md).

## Documentation

Start at [docs/README.md](docs/README.md):

- [Product boundaries](docs/product.md)
- [Architecture](docs/architecture.md)
- [Locked decisions](docs/plan/decisions.md)
- [Fleet API reference](docs/reference/fleet.md)

## Contributing

Bug reports, design feedback, and narrowly scoped pull requests are welcome through this repository. Preserve the capability-seam design: Consumers depend on `ctx.fleet`, delegated writes go through a future Fleet API backed by `ctx.subagents`, orchestration stays in `ctx.workflowEngine`, and model-visible capability follows the seams and Consumers actually mounted in the profile.

## License

[MIT](LICENSE)
