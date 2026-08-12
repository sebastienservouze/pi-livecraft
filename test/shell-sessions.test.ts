import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import {
  closeShellSession,
  createShellSession,
  shellLaunch,
  shellSessionExists,
  ShellSessionError,
  subscribeShellOutput,
  writeShellInput,
} from '../server/features/shell/shell-sessions.ts'

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return
    await delay(50)
  }
  assert.fail(`Timeout: ${label}`)
}

test('donne un pseudo-terminal au shell selon la plateforme', () => {
  const linux = shellLaunch('linux', { SHELL: '/bin/bash' })
  assert.equal(linux.command, 'script')
  assert.deepEqual(linux.args, ['-q', '-f', '-e', '-c', '/bin/bash -i', '/dev/null'])

  const macos = shellLaunch('darwin', { SHELL: '/bin/zsh' })
  assert.deepEqual(macos.args, ['-q', '/dev/null', '/bin/zsh', '-i'])

  const withoutPty = shellLaunch('linux', { SHELL: '/bin/bash' }, false)
  assert.deepEqual(withoutPty, { command: '/bin/bash', args: ['-i'], shell: '/bin/bash' })
})

test('diffuse la sortie d’une commande puis rejoue l’historique', async () => {
  const session = createShellSession(process.cwd())
  let output = ''
  const unsubscribe = subscribeShellOutput(session.id, (chunk) => {
    output += chunk.chunk
  })

  // The shell may fall back to a plain process when no pseudo terminal is available.
  await waitFor(() => output.length > 0, 'shell startup')
  writeShellInput(session.id, 'echo pi-$((2 + 3))\n')
  await waitFor(() => output.includes('pi-5'), 'command output')
  unsubscribe()

  let replayed = ''
  const stopReplay = subscribeShellOutput(session.id, (chunk) => {
    replayed += chunk.chunk
  })
  assert.ok(replayed.includes('pi-5'), 'a reconnecting panel receives the scrollback')
  stopReplay()

  closeShellSession(session.id)
  assert.equal(shellSessionExists(session.id), false)
})

test('refuse une session inconnue', () => {
  assert.throws(
    () => writeShellInput('missing', 'ls\n'),
    (error: unknown) => error instanceof ShellSessionError && error.status === 404,
  )
})
