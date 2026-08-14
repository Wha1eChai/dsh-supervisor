# 发布与回滚

本页是维护者使用的 prerelease、tarball 验证和回滚参考。当前包的首次 npm prerelease 版本为 `0.1.0-rc.1`；它应使用 `next` dist-tag，不进入 `latest`。版本依据是仓库没有既有 npm release 或 tag，产品仍处于 tool preview，且运行时兼容性固定为 DSH `0.1.0-rc.6`。

## Prerelease checklist

发布前确认：

1. 工作区干净，且 `git diff --check` 通过。
2. `package.json` 版本是目标 prerelease，当前首次版本为 `0.1.0-rc.1`。
3. Node `22.19.0` 和 `24.x` 的 CI matrix 都通过。
4. `pnpm install --frozen-lockfile`、typecheck、tests、build、pack 和 packed-content check 都通过。
5. packed artifact 包含 `dist`、`cordis.patch.yml`、`LICENSE`、`README.md` 和 `README.zh.md`。
6. packed `dist/index.js` 与 `dist/tool.js` 都能被官方 Loader unwrap，且实际 module namespace 没有 `default` export。
7. 使用隔离 `DSH_HOME` 完成 source、tarball 和 registry package 三种安装验证，并执行 `--dump-config`。
8. `README.md` 与 `README.zh.md` 的版本、状态、安装、范围、风险和 roadmap 一致。
9. 发布命令使用 prerelease dist-tag，并在发布前执行 dry run：

```sh
pnpm publish --dry-run --access public --tag next
pnpm publish --access public --tag next
```

不要在本页命令之外发布、创建 tag、创建 GitHub release 或推送分支；这些动作需要单独授权。

## Local gates

POSIX shell：

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
rm -rf .pack-output/release
mkdir -p .pack-output/release
pnpm pack --pack-destination .pack-output/release
pnpm run check:packed -- .pack-output/release
git diff --check
```

PowerShell：

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
if (Test-Path .pack-output\release) { Remove-Item .pack-output\release -Recurse -Force }
New-Item -ItemType Directory -Path .pack-output\release -Force | Out-Null
pnpm pack --pack-destination .pack-output\release
pnpm run check:packed -- .pack-output\release
git diff --check
```

## Install-source verification

发布前分别验证三种输入。每个流程都使用单独的 `DSH_HOME`，避免修改现有用户 profile。

Source checkout（POSIX shell）：

```sh
export DSH_HOME="$PWD/.dsh-cross-session-source-home"
dsh plugin --profile web add /absolute/path/to/dsh-cross-session
dsh --profile web --dump-config
```

Source checkout（PowerShell）：

```powershell
$env:DSH_HOME = "$PWD\.dsh-cross-session-source-home"
dsh plugin --profile web add D:\path\to\dsh-cross-session
dsh --profile web --dump-config
```

Packed tarball（POSIX shell）：

```sh
export DSH_HOME="$PWD/.dsh-cross-session-tarball-home"
pnpm pack --pack-destination .pack-output/release
dsh plugin --profile web add /absolute/path/to/.pack-output/release/wha1echai-dsh-cross-session-0.1.0-rc.1.tgz
dsh --profile web --dump-config
```

Packed tarball（PowerShell）：

```powershell
$env:DSH_HOME = "$PWD\.dsh-cross-session-tarball-home"
pnpm pack --pack-destination .pack-output\release
dsh plugin --profile web add D:\path\to\.pack-output\release\wha1echai-dsh-cross-session-0.1.0-rc.1.tgz
dsh --profile web --dump-config
```

Registry package（POSIX shell）：

```sh
export DSH_HOME="$PWD/.dsh-cross-session-registry-home"
rm -rf .dsh-cross-session-release-consumer
mkdir -p .dsh-cross-session-release-consumer
pnpm add @wha1echai/dsh-cross-session@0.1.0-rc.1 --dir .dsh-cross-session-release-consumer
node --input-type=module <<'NODE'
import * as index from './.dsh-cross-session-release-consumer/node_modules/@wha1echai/dsh-cross-session/dist/index.js'
import * as tool from './.dsh-cross-session-release-consumer/node_modules/@wha1echai/dsh-cross-session/dist/tool.js'
import packageJson from './.dsh-cross-session-release-consumer/node_modules/@wha1echai/dsh-cross-session/package.json' with { type: 'json' }

for (const [name, module] of [['index', index], ['tool', tool]]) {
  if ('default' in module) throw new Error(`${name} has a runtime default export`)
  for (const key of ['name', 'inject', 'Config', 'apply']) {
    if (!(key in module)) throw new Error(`${name} is missing ${key}`)
  }
}
if (packageJson.types !== './dist/index.d.ts') throw new Error('unexpected declaration entry')
if (packageJson.exports['./tool'].types !== './dist/tool.d.ts') throw new Error('unexpected tool declaration entry')
console.log('Registry package exports verified')
NODE
dsh plugin --profile web add @wha1echai/dsh-cross-session@0.1.0-rc.1
dsh --profile web --dump-config
```

Registry package（PowerShell）：

```powershell
$env:DSH_HOME = "$PWD\.dsh-cross-session-registry-home"
if (Test-Path .dsh-cross-session-release-consumer) { Remove-Item .dsh-cross-session-release-consumer -Recurse -Force }
New-Item -ItemType Directory -Path .dsh-cross-session-release-consumer -Force | Out-Null
pnpm add @wha1echai/dsh-cross-session@0.1.0-rc.1 --dir .dsh-cross-session-release-consumer
@'
import * as index from './.dsh-cross-session-release-consumer/node_modules/@wha1echai/dsh-cross-session/dist/index.js'
import * as tool from './.dsh-cross-session-release-consumer/node_modules/@wha1echai/dsh-cross-session/dist/tool.js'
import packageJson from './.dsh-cross-session-release-consumer/node_modules/@wha1echai/dsh-cross-session/package.json' with { type: 'json' }

for (const [name, module] of [['index', index], ['tool', tool]]) {
  if ('default' in module) throw new Error(`${name} has a runtime default export`)
  for (const key of ['name', 'inject', 'Config', 'apply']) {
    if (!(key in module)) throw new Error(`${name} is missing ${key}`)
  }
}
if (packageJson.types !== './dist/index.d.ts') throw new Error('unexpected declaration entry')
if (packageJson.exports['./tool'].types !== './dist/tool.d.ts') throw new Error('unexpected tool declaration entry')
console.log('Registry package exports verified')
'@ | node --input-type=module
dsh plugin --profile web add @wha1echai/dsh-cross-session@0.1.0-rc.1
dsh --profile web --dump-config
```

The registry flow requires `0.1.0-rc.1` to be available from the configured npm registry. It validates the package's public JavaScript and declaration entries, then uses the official DSH plugin installer and `--dump-config` to verify that both bundle rows load. Do not substitute a sibling harness checkout for the registry package.

## Prerelease installation

Prerelease 安装必须指定完整版本或 `next` tag，不能用裸包名依赖 npm 的默认 `latest` 选择。发布后在隔离 home 中验证：

POSIX shell：

```sh
export DSH_HOME="$PWD/.dsh-cross-session-release-home"
dsh plugin --profile web add @wha1echai/dsh-cross-session@0.1.0-rc.1
dsh --profile web --dump-config
```

PowerShell：

```powershell
$env:DSH_HOME = "$PWD\.dsh-cross-session-release-home"
dsh plugin --profile web add @wha1echai/dsh-cross-session@0.1.0-rc.1
dsh --profile web --dump-config
```

`--dump-config` 应看到 `dsh-cross-session` 和 `dsh-cross-session-tools` 两个 bundle rows。随后可以用该隔离 home 启动最小 Web smoke；不要连接现有用户 profile。

## Rollback

回滚操作也必须先切换到专用 `DSH_HOME`，避免修改其他 profile。POSIX shell：

```sh
export DSH_HOME="$PWD/.dsh-cross-session-release-home"
dsh plugin --profile web add @wha1echai/dsh-cross-session@0.1.0-rc.1
dsh --profile web --dump-config
```

PowerShell：

```powershell
$env:DSH_HOME = "$PWD\.dsh-cross-session-release-home"
dsh plugin --profile web add @wha1echai/dsh-cross-session@0.1.0-rc.1
dsh --profile web --dump-config
```

完全移除：

POSIX shell：

```sh
export DSH_HOME="$PWD/.dsh-cross-session-release-home"
dsh plugin --profile web remove @wha1echai/dsh-cross-session
dsh --profile web --dump-config
```

PowerShell：

```powershell
$env:DSH_HOME = "$PWD\.dsh-cross-session-release-home"
dsh plugin --profile web remove @wha1echai/dsh-cross-session
dsh --profile web --dump-config
```

移除后两个 bundle rows 都应消失，profile 仍应能 dump。`dsh plugin` 管理命令不会启动 Web runtime；即使插件造成 profile 启动失败，也应优先通过 `dsh plugin ... remove` 回退，而不是手动修改 profile manifest。

不要在未授权时撤销 npm 版本、覆盖 dist-tag 或删除发布内容。发布后的错误版本先通过 profile 回退隔离影响，再由维护者决定后续 npm 处置。
