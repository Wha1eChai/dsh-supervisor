import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requestedDirectory = process.argv.slice(2).find(argument => argument !== '--')
const outputDirectory = resolve(root, requestedDirectory ?? '')
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

if (!requestedDirectory) fail('Usage: pnpm run check:packed -- <pack-directory>')
const entries = await readdir(outputDirectory, { withFileTypes: true })
const tarballs = entries.filter(entry => entry.isFile() && entry.name.endsWith('.tgz'))
if (tarballs.length !== 1) fail(`Expected exactly one .tgz in ${outputDirectory}, found ${tarballs.length}`)
const tarball = join(outputDirectory, tarballs[0].name)

const tarballArgument = relative(root, tarball).replaceAll('\\', '/')
const archiveListing = await command('tar', ['-tzf', tarballArgument], root)
const files = new Set(archiveListing.stdout.split(/\r?\n/).filter(Boolean))
const required = [
  'package/package.json',
  'package/cordis.patch.yml',
  'package/LICENSE',
  'package/README.md',
  'package/README.zh.md',
  'package/dist/index.js',
  'package/dist/index.d.ts',
  'package/dist/tool.js',
  'package/dist/tool.d.ts',
]
for (const file of required) if (!files.has(file)) fail(`Packed artifact is missing ${file}`)
const deniedPrefixes = ['package/src/', 'package/tests/', 'package/.github/', 'package/node_modules/']
const deniedNames = new Set([
  'package/pnpm-lock.yaml',
  'package/package-lock.json',
  'package/yarn.lock',
  'package/.env',
])
for (const file of files) {
  if (file.endsWith('/AGENTS.md') || deniedNames.has(file) || deniedPrefixes.some(prefix => file.startsWith(prefix))) {
    fail(`Packed artifact contains denied path ${file}`)
  }
}

const tempDirectory = await mkdtemp(join(root, '.pack-output-check-'))
try {
  const tempDirectoryArgument = relative(root, tempDirectory).replaceAll('\\', '/')
  await command('tar', ['-xzf', tarballArgument, '-C', tempDirectoryArgument], root)
  const packedPackage = JSON.parse(await readFile(join(tempDirectory, 'package/package.json'), 'utf8'))
  if (packedPackage.version !== packageJson.version) {
    fail(`Packed version ${packedPackage.version} does not match root version ${packageJson.version}`)
  }
  await verifyEntry(join(tempDirectory, 'package/dist/index.js'), 'dsh-cross-session', ['agents'])
  await verifyEntry(join(tempDirectory, 'package/dist/tool.js'), 'tool-dsh-cross-session', ['tools', 'fleet'])

  const selfReferenceModule = join(tempDirectory, 'package/check-self-reference.mjs')
  await writeFile(selfReferenceModule, [
    "import * as index from '@wha1echai/dsh-cross-session'",
    "import * as tool from '@wha1echai/dsh-cross-session/tool'",
    'export { index, tool }',
    '',
  ].join('\n'))
  const { index: importer, tool: toolImporter } = await import(pathToFileURL(selfReferenceModule).href)
  for (const [specifier, module] of [
    ['@wha1echai/dsh-cross-session', importer],
    ['@wha1echai/dsh-cross-session/tool', toolImporter],
  ]) {
    if ('default' in module) fail(`${specifier} has a runtime default export`)
    if (module.name === undefined || module.inject === undefined || module.Config === undefined || module.apply === undefined) {
      fail(`${specifier} is missing namespace plugin metadata`)
    }
  }
} finally {
  await rm(tempDirectory, { recursive: true, force: true })
}

console.log(`Packed artifact verified: ${tarball}`)

async function verifyEntry(file, expectedName, expectedInject) {
  const module = await import(pathToFileURL(file).href)
  if ('default' in module) fail(`${file} has a runtime default export`)
  const Loader = (await import('@deepseek-ai/cordis-plugin-loader')).default
  const loader = Object.create(Loader.prototype)
  const unwrapped = loader.unwrapExports(module)
  if (unwrapped !== module) fail(`${file} was not preserved by Loader.unwrapExports`)
  if (module.name !== expectedName) fail(`${file} has unexpected name ${String(module.name)}`)
  if (JSON.stringify(module.inject) !== JSON.stringify(expectedInject)) fail(`${file} has unexpected inject metadata`)
  for (const key of ['Config', 'apply']) if (typeof module[key] !== 'function') fail(`${file} is missing ${key}`)
}

async function command(file, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => {
      if (code === 0) resolvePromise({ stdout, stderr })
      else reject(new Error(`${file} ${args.join(' ')} exited with ${code}: ${stderr}`))
    })
  })
}

function fail(message) {
  console.error(`check:packed: ${message}`)
  process.exitCode = 1
  throw new Error(message)
}
