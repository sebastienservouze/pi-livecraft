import assert from 'node:assert/strict'
import test from 'node:test'
import {
  externalWorkspacePath,
  getDesktopPlatform,
  getWslDistributionName,
} from '../server/system-integration.ts'

test('detects Linux, WSL, and Windows from the runtime environment', () => {
  assert.equal(getDesktopPlatform('linux', {}), 'linux')
  assert.equal(getDesktopPlatform('linux', { WSL_DISTRO_NAME: 'Ubuntu' }), 'wsl')
  assert.equal(getDesktopPlatform('win32', {}), 'windows')
  assert.throws(() => getDesktopPlatform('darwin', {}), /Unsupported platform: darwin/)
})

test('reads the current WSL distribution name when available', () => {
  assert.equal(getWslDistributionName({ WSL_DISTRO_NAME: 'Ubuntu-22.04' }), 'Ubuntu-22.04')
  assert.equal(getWslDistributionName({ WSL_INTEROP: '/run/WSL/1_interop' }), undefined)
})

test('keeps native workspace paths unchanged', async () => {
  assert.equal(await externalWorkspacePath('/home/user/project', 'linux'), '/home/user/project')
  assert.equal(
    await externalWorkspacePath('C:\\Users\\user\\project', 'windows'),
    'C:\\Users\\user\\project',
  )
})

test('converts WSL workspace paths through the injected converter', async () => {
  const converted = await externalWorkspacePath('/home/user/project', 'wsl', async (path) => {
    assert.equal(path, '/home/user/project')
    return '\\\\wsl.localhost\\Ubuntu\\home\\user\\project'
  })
  assert.equal(converted, '\\\\wsl.localhost\\Ubuntu\\home\\user\\project')
})
