# AGENTS.md

External DeepSeek Harness control-plane plugin. Read [docs/README.md](docs/README.md) before changing behavior.

## Product

- This package is a `dsh` plugin, not a second harness and not a fork of `deepseek-ai/deepseek-harness`.
- Capability seam only: `ctx.fleet` is the Service Definition; the in-process adapter is a replaceable Provider; tools/presets/transports are Consumers.
- Consumers must not call `ctx.agents.get(id).followup(...)`. Child write/interrupt paths belong to `ctx.subagents` when that seam exists.
- Do not hold `AgentHandle.dispose`. Do not publish `@deepseek-ai/*` names.

## Locked decisions

[docs/plan/decisions.md](docs/plan/decisions.md) is authoritative. Current implementation target is L0+L1 only ([docs/plan/phase-l0.md](docs/plan/phase-l0.md), [docs/plan/phase-l1.md](docs/plan/phase-l1.md)).

## Engineering

- pnpm only. ESM (`"type": "module"`).
- Pin directly imported DSH public peers exactly to `0.1.0-rc.6`. The harness source checkout may be `0.1.0-rc.5`; do not treat it as the runtime.
- Follow the official plugin rules: export a Schemastery `Config` for deployment tunables, declare required services with `inject`, own registrations through `ctx`, and ship `prepare` for Git installs.
- Tests are keyless unit tests with mocked agents. Do not add API-key e2e as the L1 gate.
- Code, identifiers, and commit messages in English. User-facing docs in Chinese.
- Files end with exactly one trailing newline.
