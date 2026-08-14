# Contributing to dsh-cross-session

`dsh-cross-session` is an independent community plugin for the published DeepSeek Harness runtime. It is not a harness fork, and contributions must not modify the sibling `deepseek-harness` repository.

## Scope

The supported product is discovery, inspection, and communication among live Sessions in one running DSH runtime, meaning one `dsh` process. Cross-process, cross-terminal, cross-device, remote Web, gateway, daemon, and multi-runtime control are not current features.

Consumers depend on `ctx.fleet`. They must not call `ctx.agents`, `Agent.followup`, `Agent.steer`, or `Agent.cancel` directly. Delegated-session continuation and interruption use the public `ctx.subagents` seam when a future Fleet API supports them; orchestration remains in `ctx.workflowEngine`.

## Development requirements

- Node.js `^22.19.0 || >=24.0.0`.
- pnpm `11.7.0`.
- pnpm is the only supported package manager. Do not add npm or Yarn lockfiles.
- The supported DSH runtime is `0.1.0-rc.6`; directly imported DSH peers use the exact version.
- Keep the package build and `prepare` script independent of a sibling harness checkout.

Use the repository gates in this order:

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack --pack-destination .pack-output/dev
pnpm run check:packed -- .pack-output/dev
```

Use an isolated `DSH_HOME` for installation and runtime smoke tests. Do not commit credentials, `DSH_HOME`, tarballs, `dist`, or scratch output.

## Pull requests

Keep `README.md` and `README.zh.md` aligned when changing public status, installation, scope, risk, or roadmap statements. Every registry contribution needs unload/HMR coverage. Model-visible tool changes need coverage for parameter schemas, canonical output, rendering, errors, caller identity, and cleanup. Changes that wake or interrupt other Sessions must document their model/tool resource effects.

PRs should explain the focused behavior change, list the commands run, and preserve the package's named namespace exports. Runtime namespace entries must not add a JavaScript `default` export because the official Loader uses it as an interop signal.

Do not publish, tag, or release from a development checkout. Release procedures are in [docs/release.md](docs/release.md).
