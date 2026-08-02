import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  externalWorkspacePath,
  getDesktopPlatform,
  getWslDistributionName,
  openPath,
} from '../server/system-integration.ts'

test('detects Linux and WSL from the runtime environment', () => {
  assert.equal(getDesktopPlatform('linux', {}), 'linux')
  assert.equal(getDesktopPlatform('linux', { WSL_DISTRO_NAME: 'Ubuntu' }), 'wsl')
  assert.equal(getDesktopPlatform('win32', {}), 'windows')
})

test('reads the current WSL distribution name when available', () => {
  assert.equal(getWslDistributionName({ WSL_DISTRO_NAME: 'Ubuntu-22.04' }), 'Ubuntu-22.04')
  assert.equal(getWslDistributionName({ WSL_INTEROP: '/run/WSL/1_interop' }), undefined)
})

test('keeps Linux and native Windows workspace paths unchanged', async () => {
  assert.equal(await externalWorkspacePath('/home/user/project', 'linux'), '/home/user/project')
  assert.equal(await externalWorkspacePath('C:\\Users\\Ada', 'windows'), 'C:\\Users\\Ada')
})

test('opens Windows paths through a hidden PowerShell broker with a visible shell-associated process', async () => {
  let call:
    | {
      command: string
      args: string[]
      env?: NodeJS.ProcessEnv
      shell?: string | boolean
      windowsHide?: boolean
    }
    | undefined
  await openPath(
    'C:\\hostile & ü\\"file"',
    'windows',
    ((
      command: string,
      args: string[],
      options: Parameters<typeof spawn>[2],
    ) => {
      call = {
        command,
        args,
        env: options?.env,
        shell: options?.shell,
        windowsHide: options?.windowsHide,
      }
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      queueMicrotask(() => child.emit('exit', 0))
      return child as never
    }) as never,
    async () => ({ isDirectory: () => false }),
  )
  assert.deepEqual(call?.args, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '$ErrorActionPreference = "Stop"; Start-Process -FilePath $env:PI_LIVECRAFT_OPEN_PATH -WindowStyle Normal',
  ])
  assert.equal(call?.command, 'powershell.exe')
  assert.equal(call?.env?.PI_LIVECRAFT_OPEN_PATH, 'C:\\hostile & ü\\"file"')
  assert.equal(call?.shell, false)
  assert.equal(call?.windowsHide, true)
})

test('opens Windows directories through visible Explorer with native argument data', async () => {
  let call:
    | { command: string; args: string[]; options: Parameters<typeof spawn>[2] }
    | undefined
  let unrefCalled = false
  await openPath(
    'C:\\hostile & ü\\workspace',
    'windows',
    ((command: string, args: string[], options: Parameters<typeof spawn>[2]) => {
      call = { command, args, options }
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = () => {
        unrefCalled = true
      }
      queueMicrotask(() => child.emit('spawn'))
      return child as never
    }) as never,
    async () => ({ isDirectory: () => true }),
  )

  assert.equal(call?.command, 'explorer.exe')
  assert.deepEqual(call?.args, ['C:\\hostile & ü\\workspace'])
  assert.equal(call?.options?.detached, true)
  assert.equal(call?.options?.shell, false)
  assert.equal(call?.options?.stdio, 'ignore')
  assert.equal(call?.options?.windowsHide, false)
  assert.equal(unrefCalled, true)
})

test('converts WSL workspace paths through the injected converter', async () => {
  const converted = await externalWorkspacePath('/home/user/project', 'wsl', async (path) => {
    assert.equal(path, '/home/user/project')
    return '\\\\wsl.localhost\\Ubuntu\\home\\user\\project'
  })
  assert.equal(converted, '\\\\wsl.localhost\\Ubuntu\\home\\user\\project')
})
