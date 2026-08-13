# AGENTS.md

`dsh-supervisor` is an independent community plugin for DeepSeek Harness. Read [README.md](README.md), [docs/README.md](docs/README.md), and [docs/plan/decisions.md](docs/plan/decisions.md) before changing behavior.

## Product boundary

- This repository extends the published `dsh` runtime; it is not a second harness and not a fork of `deepseek-ai/deepseek-harness`.
- Do not edit the sibling `deepseek-harness` checkout. It is read-only reference material and may be on a different release candidate from the supported runtime.
- Publish only under the `@wha1echai/*` scope. Never claim DeepSeek affiliation or publish `@deepseek-ai/*` names.
- Keep work within the current phase in [docs/plan/layers.md](docs/plan/layers.md). Do not pull Electron, transports, daemon behavior, or future presets into an earlier phase.

## Capability design

A replaceable capability has three roles: Service Definition, Provider, and Consumer. Keep the dependency direction explicit:

```text
Consumer -> FleetService <- Provider
```

- `ctx.fleet` and its request/result/error types are the Fleet Service Definition.
- `InProcessFleetProvider` is the default Provider over `ctx.agents`.
- Tools, commands, presets, transports, and UIs are Consumers and depend only on `ctx.fleet`.
- Consumers must never call `ctx.agents`, `Agent.followup`, `Agent.steer`, or `Agent.cancel` directly.
- Delegated-session continuation, interruption, and child enumeration belong to the public `ctx.subagents` seam. Never import a concrete subagent Provider.
- Orchestration belongs to `ctx.workflowEngine`. Fleet must not become another workflow runtime.
- Do not retain or invoke `AgentHandle.dispose`.
- Views and transport-facing results remain lossless JSON values; do not expose `Agent`, `Session`, raw event arrays, functions, or Cordis objects.

## Plugin and lifecycle rules

Follow the official DSH plugin documentation under the sibling checkout's `docs/user/develop/` directory.

- Namespace plugins export named `name`, `inject`, optional `Config`, and `apply`. Do not add a sibling `default` export: the official Loader prefers it and discards namespace metadata.
- Declare every required service in `inject`; read optional services through `ctx.get(name)` or an optional child injection.
- Deployment-varying values are Schemastery `Config` fields. Validate self-contained invalid configuration during plugin load.
- Every registration is owned by the contributing Cordis fiber through `ctx.on`, `ctx.effect`, `ctx.plugin`, or the registry's disposer contract.
- Provider unload stops new operations. A retained old Service reference must fail without touching registries or runtime objects.
- Observer failures are contained and must not veto authoritative Agent lifecycle events.
- Keep the Bundle patch additive. `cordis.patch.yml` inserts repository-owned rows and does not replace unrelated profile configuration.
- Git source installation must remain self-contained through `prepare`; published tarballs and registry packages contain built runtime artifacts.

## Model-facing tools

Follow the official tool authoring reference before adding or changing a tool.

- Register tools through `ctx.tools.register(defineTool(...))` with `inject` containing `tools` and the consumed Service.
- `execute` returns one canonical JSON value declared by `output.schema`; it does not return content blocks or prose-only identifiers.
- `output.render` owns model-facing text. Tool schemas, descriptions, rendered text, error behavior, and card intent are user-visible behavior.
- Choose UI render intent up front. Fleet tools use a generic card unless a later design establishes a more specific neutral card.
- Presentation functions are pure functions of arguments and durable result data: no I/O, clock, random values, or session reads.
- Honor `exec.signal` for asynchronous work. Use `exec.agent?.session.id` as `callerSessionId` for write tools; fail loud when safe self-target protection requires an owning Agent but none exists.
- Do not duplicate authorization policy in tools. Deployment policy belongs in configuration or the Tools policy extension points.

## Versions and package management

- pnpm only; do not add npm or Yarn lockfiles.
- ESM only (`"type": "module"`) and Node `^22.19.0 || >=24.0.0`.
- The supported runtime is `@deepseek-ai/dsh@0.1.0-rc.6` until a dedicated compatibility change updates it.
- Directly imported DSH peers use exact `0.1.0-rc.6` versions. Optional peers are declared in `peerDependenciesMeta`.
- Keep the package build and `prepare` independent from a sibling monorepo checkout.

## Source and prose

- Code, identifiers, diagnostics, commit messages, and model-facing tool text are English.
- Keep `README.md` and `README.zh.md` aligned for public installation, status, and roadmap changes.
- User-facing Chinese documentation lives under `docs/`; update contracts, configuration, and limitations with the code.
- Public exports and non-obvious lifecycle behavior require concise JSDoc. Do not narrate control flow or preserve review history in comments.
- Files end with exactly one trailing newline.

## Testing

Run the smallest checks that prove the changed behavior, then the complete package gates before a push.

- Unit tests cover domain behavior and negative paths with keyless fixtures.
- Every registry contribution has an unload/HMR cleanup test.
- Namespace plugin entries have an explicit no-`default` assertion and `Loader.unwrapExports()` round trip.
- Product-visible plugins require a keyless real Loader composition through a test-only `cordis.yml` and the built package entry. Hand-mounted `ctx.plugin(...)` tests do not replace this.
- Model-visible tool changes test parameter schemas, canonical values, rendered content, error containment, caller identity, and tool unload.
- A regression guard must demonstrably fail when its regression is reintroduced.

Required package gates:

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack
```

Use an isolated `DSH_HOME` for installation and Web smoke tests. Never modify the user's existing DSH home.

## Git and release hygiene

- Work on a focused branch; keep `main` releasable.
- Do not mix unrelated changes or revert user work.
- Commit coherent, verified units with concise English messages.
- Never force-push, publish to npm, create a release, deploy, or change repository visibility without explicit user authorization.
- Before pushing, inspect `git diff --check`, run relevant gates once, push normally, and verify the remote ref equals local `HEAD`.
- Never commit credentials, local DSH homes, `node_modules`, build scratch directories, or packed tarballs.
