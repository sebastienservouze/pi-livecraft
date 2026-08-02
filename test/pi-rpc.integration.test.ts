import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { JsonLineDecoder, encodeJsonLine } from '../server/jsonl.ts'
import { piSpawnInvocation, terminatePiChild } from '../server/pi-process.ts'
import type { JsonObject } from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'

test('exposes current Pi commands over RPC', { timeout: 30_000 }, async (t) => {
  const invocation = piSpawnInvocation(
    ['--mode', 'rpc', '--offline', '--no-session'],
    process.platform,
    { ...process.env, PI_OFFLINE: '1' },
  )
  const pi = spawn(invocation.command, invocation.args, {
    cwd: join(homedir(), '.pi'),
    env: invocation.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const values: JsonObject[] = []
  const waiters = new Set<() => void>()
  let stderr = ''
  const decoder = new JsonLineDecoder((value) => {
    if (isObject(value)) values.push(value)
    for (const notify of waiters) notify()
  })
  pi.stdout.on('data', (chunk: Buffer) => decoder.push(chunk))
  pi.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })

  try {
    const commandsResponse = waitFor((value) =>
      value.type === 'response' && value.id === 'commands'
    )
    pi.stdin.write(encodeJsonLine({ id: 'commands', type: 'get_commands' }))
    const response = await commandsResponse
    assert.equal(response.success, true)
    const hasAgentCommand = isObject(response.data)
      && Array.isArray(response.data.commands)
      && response.data.commands.some((command) => isObject(command) && command.name === 'agent')
    if (!hasAgentCommand) {
      t.skip('Pi /agent extension is not installed')
      return
    }

    const dialogRequest = waitFor((value) =>
      value.type === 'extension_ui_request' && value.method === 'select'
    )
    const promptResponse = waitFor((value) =>
      value.type === 'response' && value.id === 'agent-selector'
    )
    pi.stdin.write(encodeJsonLine({ id: 'agent-selector', type: 'prompt', message: '/agent' }))
    const dialog = await dialogRequest
    assert.equal(dialog.title, 'Select an agent')
    assert.ok(Array.isArray(dialog.options) && dialog.options.length > 0)
    assert.ok(dialog.options.every((option) => typeof option === 'string'))
    pi.stdin.write(
      encodeJsonLine({ type: 'extension_ui_response', id: dialog.id, cancelled: true }),
    )
    assert.equal((await promptResponse).success, true)
  } finally {
    terminatePiChild(pi)
  }

  function waitFor(predicate: (value: JsonObject) => boolean): Promise<JsonObject> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        waiters.delete(check)
        reject(new Error(`Timed out waiting for Pi RPC event. stderr: ${stderr}`))
      }, 15_000)
      function check(): void {
        const index = values.findIndex(predicate)
        if (index === -1) return
        clearTimeout(timeout)
        waiters.delete(check)
        resolve(values.splice(index, 1)[0])
      }
      waiters.add(check)
      check()
    })
  }
})
