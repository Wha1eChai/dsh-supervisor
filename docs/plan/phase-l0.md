# L0 — 仓库骨架

## 目标

`D:\coding\programs\dsh\dsh-cross-session` 成为可用 pnpm 管理、能装进官方 `dsh@0.1.0-rc.6` 的外部 bundle。

## 交付

```text
dsh-cross-session/
├─ package.json              # @wha1echai/dsh-cross-session, type:module, dsh.bundle
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml       # 单包也显式声明，避免以后拆包换工具
├─ tsconfig.json
├─ vitest.config.ts
├─ tests/loader-composition.spec.ts # 构建产物经真实 Loader + cordis.yml 激活
├─ cordis.patch.yml          # 只 insert 本包 row
├─ src/index.ts              # 最小 apply：挂 Fleet 或先打 loaded 日志
├─ README.md                 # 已有
├─ AGENTS.md
├─ docs/                     # 已有文档组
└─ .gitignore
```

`package.json` 要点：

- `"packageManager": "pnpm@<本机 pnpm 主版本>"`
- `"type": "module"`
- `"main"` / `exports` 指向构建产物（`dist/` 或 `lib/`，选一个并在全仓库统一）
- `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`
- `peerDependencies`：`@deepseek-ai/cordis` 以及 L1 需要的 `@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-llm`
- 版本范围钉在与 `dsh@0.1.0-rc.6` 一致的公开包，不要 `workspace:`
- scripts：`build`、`test`、`typecheck`、`prepare`；`prepare` 必须从干净 Git 安装构建 TypeScript，满足官方 GitHub 安装规范
- 入口采用 namespace plugin（具名 `name` / `inject` / `Config` / `apply`），禁止同时导出 `default`；真实 Loader 会优先 unwrap `default` 并丢掉同级注入元数据
- 插件接受配置时同时导出 `interface Config` 与 Schemastery `const Config`；默认值和自包含约束写在 schema 上
- 直接 import 的 DSH 公开包使用精确 `0.1.0-rc.6` peer；可选的 `@deepseek-ai/dsh-subagent` 标成 optional peer 并仅作类型/可选服务探测

`cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-cross-session
      name: '@wha1echai/dsh-cross-session'
```

不要覆盖官方 row。

## 验收

在隔离 home 中：

```powershell
$env:DSH_HOME = "D:\coding\programs\dsh\.dsh-cross-session-home"
dsh plugin --profile web add D:\coding\programs\dsh\dsh-cross-session
dsh --profile web --dump-config
```

- dump 里出现 `# == @wha1echai/dsh-cross-session` 或等价层注释，以及 `id: dsh-cross-session`
- `dsh web` 能启动（可用 `--dump-config` 代替长时间挂起）
- 仓库内 `pnpm test` 必须包含：无 `default` + `Loader.unwrapExports()` 回归；以及 test-only `cordis.yml` 经官方 Loader 导入构建后的 `dist/index.js`、激活并卸载 `ctx.fleet`

## 不做

- Electron 目录里的真实应用
- fleet 工具
- 独立 supervisor profile
- 改 `deepseek-harness` 源码
