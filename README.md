# dsh-supervisor

English | [中文](README.zh.md)

A community control-plane plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It exposes a replaceable `ctx.fleet` service for observing and controlling live sessions in the same `dsh` process, plus model-callable `fleet_*` tools over that service.

> **Status: tool preview (L0 + L1 + L2).** The Fleet service and five tool Consumer definitions are implemented and keylessly tested through the built package entries.

This is an independent community project and is not affiliated with or endorsed by DeepSeek AI.

## Design

DeepSeek Harness treats capabilities as hot-swappable plugin seams. `dsh-supervisor` follows the same structure:

```text
FleetService                  Service Definition (`ctx.fleet`)
InProcessFleetProvider        Default Provider (`ctx.agents`)
fleet_* tools                 Consumer (`ctx.fleet` + `ctx.tools`)
supervisor preset / transport Planned Consumers (L3+)
```

The tool Consumer never imports the Agent or Subagent APIs and does not access `ctx.agents`, `ctx.sessions`, or `ctx.subagents`. The plugin does not replace the existing subagent or workflow runtimes:

- delegated-session continuation and interruption belong to `ctx.subagents`;
- orchestration belongs to `ctx.workflowEngine`;
- Fleet adds process-wide live-session observation and limited root-session control.

See [docs/architecture.md](docs/architecture.md) for the complete constraints.

## Current capabilities

`ctx.fleet` provides:

- `list()` — list live agents in the current process;
- `inspect()` — return a bounded, JSON-safe transcript summary;
- `send()` — enqueue a plugin-sourced follow-up for a live root agent;
- `steer()` — steer a live root agent;
- `cancel()` — cancel a live root agent with a stable Fleet cause;
- `subscribe()` — observe projected create/status/dispose events.

The separate `@wha1echai/dsh-supervisor/tool` entry registers:

- `fleet_list` and `fleet_inspect` in every mode;
- `fleet_send` and `fleet_steer` in `message` and `full` modes;
- `fleet_cancel` only in `full` mode.

The default `controlMode` is `read-only`. Write tools derive caller identity only from their owning Agent session, reject agentless execution, and pass self/delegated authorization to `ctx.fleet`. Delegated agents remain read-only in L2; the Consumer never bypasses Fleet to call subagent APIs directly.

API, configuration, tools, and error codes are documented in [docs/reference/fleet.md](docs/reference/fleet.md).

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
  // Build another command, UI adapter, or transport from the JSON-safe view.
}
```

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
- [ ] **L2b** — delegated-session write API with exact parent authority through the public subagent seam.
- [ ] **L3** — supervisor agent preset using Fleet and the existing workflow seam.
- [ ] **L4** — dedicated profile and local transport.
- [ ] **L5** — optional Electron shell that launches and connects to `dsh`.
- [ ] **L6** — daemon and multi-runtime Fleet Providers.
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

Bug reports, design feedback, and narrowly scoped pull requests are welcome through this repository. Preserve the capability-seam design: Consumers depend on `ctx.fleet`, delegated writes go through a future Fleet API backed by `ctx.subagents`, and orchestration stays in `ctx.workflowEngine`.

## License

[MIT](LICENSE)
