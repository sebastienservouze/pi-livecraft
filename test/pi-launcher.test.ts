import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { resolvePiLauncher } from '../server/pi-launcher.ts'

async function npmPiLayout(): Promise<{ root: string; bin: string; cli: string }> {
  const root = await mkdtemp(join(tmpdir(), 'pi launcher ü '))
  const bin = join(root, 'node_modules', '.bin')
  const packageRoot = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent')
  const cli = join(packageRoot, 'dist', 'cli.mjs')
  await mkdir(join(packageRoot, 'dist'), { recursive: true })
  await mkdir(bin, { recursive: true })
  await writeFile(join(bin, 'pi.cmd'), '@echo hostile shim')
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({ bin: { pi: 'dist/cli.mjs' } }),
  )
  return { root, bin, cli }
}

test('resolves the package CLI behind pi.cmd without executing it', async (t) => {
  const { root, bin, cli } = await npmPiLayout()
  t.after(() => rm(root, { force: true, recursive: true }))
  await writeFile(cli, '')
  const invocation = resolvePiLauncher('win32', { PaTh: bin }, ';')
  assert.equal(invocation.command, process.execPath)
  assert.equal(invocation.argsPrefix[0], cli)
})

test('passes hostile RPC values to the resolved CLI exactly as argument-array data', async (t) => {
  const { root, bin, cli } = await npmPiLayout()
  const output = join(root, 'argv.json')
  t.after(() => rm(root, { force: true, recursive: true }))
  await writeFile(
    cli,
    `import { writeFile } from 'node:fs/promises'; await writeFile(${
      JSON.stringify(output)
    }, JSON.stringify(process.argv.slice(2)))`,
  )
  const invocation = resolvePiLauncher('win32', { PATH: bin }, ';')
  const hostile = [
    'with spaces',
    'émoji-東京',
    '"quote"',
    '%percent%',
    '!bang!',
    '&ampersand',
    '^caret',
    '(group)',
  ]
  const child = spawn(
    invocation.command,
    [...invocation.argsPrefix, '--system-prompt', ...hostile],
    { shell: false },
  )
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`CLI exited ${code}`)))
  })
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), ['--system-prompt', ...hostile])
})
