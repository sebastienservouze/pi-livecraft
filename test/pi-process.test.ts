import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { forceKillWindowsProcessTree, piSpawnInvocation } from '../server/pi-process.ts'

test('launches Pi directly outside Windows', () => {
  const env = { PATH: '/bin' }
  assert.deepEqual(piSpawnInvocation(['--mode', 'rpc'], 'linux', env), {
    command: 'pi',
    args: ['--mode', 'rpc'],
    env,
  })
})

test('force-kills a complete Windows process tree', {
  skip: process.platform !== 'win32',
  timeout: 10_000,
}, async (t) => {
  const grandchildSource = 'setInterval(() => {}, 1_000)'
  const parentSource = `
    const { spawn } = require('node:child_process')
    const child = spawn(process.execPath, ['-e', ${
    JSON.stringify(grandchildSource)
  }], { stdio: 'ignore' })
    process.stdout.write(String(child.pid))
    setInterval(() => {}, 1_000)
  `
  const child = spawn(process.execPath, ['-e', parentSource], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    await forceKillWindowsProcessTree(child)
    await exited
  })
  const grandchildPid = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.stdout.once('data', (data: Buffer) => resolve(Number(data.toString('utf8'))))
  })
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))

  await forceKillWindowsProcessTree(child)
  await exited

  assert.throws(() => process.kill(grandchildPid, 0), { code: 'ESRCH' })
})

test('resolves the Windows npm shim target without altering Pi arguments', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-windows-shim-'))
  const relativeTarget = 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'
  const target = join(directory, relativeTarget)
  const piArgs = [
    '--session',
    'C:\\work & review\\session.jsonl',
    '--system-prompt',
    'Use "quotes" and $variables — été\nsecond line',
    'C:\\trailing\\',
    '',
  ]
  const env = { Path: directory }

  try {
    mkdirSync(join(directory, 'node_modules/@earendil-works/pi-coding-agent/dist'), {
      recursive: true,
    })
    writeFileSync(target, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n')
    writeFileSync(
      join(directory, 'pi.ps1'),
      '& "node$exe" "$basedir/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" $args\n',
    )

    const invocation = piSpawnInvocation(piArgs, 'win32', env)
    assert.deepEqual(invocation, {
      command: process.execPath,
      args: [target, ...piArgs],
      env,
    })

    const result = spawnSync(invocation.command, invocation.args, {
      encoding: 'utf8',
      env: invocation.env,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), piArgs)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
