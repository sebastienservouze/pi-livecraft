import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawn } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import test from 'node:test'
import { isObject } from '../shared/is-object.ts'

test(
  'keeps supervision alive without relaunching a manager that crashes',
  { timeout: 10_000 },
  async (t) => {
    const supervisor = spawn(process.execPath, ['server/manager-supervisor.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, PI_LIVECRAFT_MANAGER_PORT: 'invalid' },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    t.after(() => stopChild(supervisor))
    let errors = ''
    supervisor.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString('utf8')
    })

    await waitFor(() => errors.includes('PI_LIVECRAFT_MANAGER_PORT must be a valid port'))
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(supervisor.exitCode, null)
    assert.equal(errors.match(/PI_LIVECRAFT_MANAGER_PORT must be a valid port/g)?.length, 1)

    await stopChild(supervisor)
  },
)

test(
  'restarts a supervised manager only after an explicit request',
  { timeout: 10_000 },
  async () => {
    const port = 45_000 + (process.pid % 10_000)
    const supervisor = spawn(process.execPath, ['server/manager-supervisor.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, PI_LIVECRAFT_MANAGER_PORT: String(port) },
      stdio: 'ignore',
    })
    const firstClient = await connectManager(port)
    try {
      const firstStatus = await firstClient.request('status', {})
      assert.equal(firstStatus.ok, true)
      assert.equal(isObject(firstStatus.data) && firstStatus.data.supervised, true)
      const firstInstanceId = isObject(firstStatus.data) ? firstStatus.data.instanceId : undefined
      assert.equal(typeof firstInstanceId, 'string')

      const restart = await firstClient.request('restart', {})
      assert.equal(restart.ok, true)
      firstClient.close()
      await new Promise((resolve) => setTimeout(resolve, 200))

      const secondClient = await connectManager(port)
      try {
        const secondStatus = await secondClient.request('status', {})
        const secondInstanceId = isObject(secondStatus.data)
          ? secondStatus.data.instanceId
          : undefined
        assert.equal(typeof secondInstanceId, 'string')
        assert.notEqual(secondInstanceId, firstInstanceId)
      } finally {
        secondClient.close()
      }
    } finally {
      firstClient.close()
      await stopChild(supervisor)
    }
  },
)

test('reconciles live Pi work before restarting the manager', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-manager-'))
  const port = 45_000 + (process.pid % 10_000)
  await writeFakePi(directory)
  const manager = spawn(process.execPath, ['server/manager.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${directory}${delimiter}${process.env.PATH}`,
      PI_LIVECRAFT_MANAGER_PORT: String(port),
      PI_LIVECRAFT_MANAGER_RESTART_EXIT_CODE: '75',
      PI_LIVECRAFT_MANAGER_RUNTIME_REVISION: 'test-revision',
      PI_LIVECRAFT_MANAGER_SUPERVISED: '1',
    },
    stdio: 'ignore',
  })
  const client = await connectManager(port)
  try {
    const opened = await client.request('open', {
      cwd: process.cwd(),
      name: 'Active',
      sessionPath: join(directory, 'active.jsonl'),
    })
    assert.equal(
      (await client.request('command', {
        sessionId: sessionId(opened),
        command: { type: 'prompt', message: '/select' },
      }))
        .ok,
      true,
    )
    const waitingSessions = await client.request('list', {})
    assert.equal(sessionStatus(waitingSessions, sessionId(opened)), 'idle')
    assert.ok(
      sessionPendingUi(waitingSessions, sessionId(opened)).some(
        (r) => isObject(r) && r.id === 'select-test',
      ),
      'Agent selector should appear in pendingUi after /select',
    )
    assert.equal(
      (await client.request('command', {
        sessionId: sessionId(opened),
        command: { type: 'extension_ui_response', id: 'select-test', value: 'worker' },
      }))
        .ok,
      true,
    )
    const clearedUi = sessionPendingUi(
      await client.request('list', {}),
      sessionId(opened),
    )
    assert.equal(
      clearedUi.filter((r) => isObject(r) && r.method === 'select').length,
      0,
      'Agent selector should be cleared from pendingUi after response',
    )

    const pendingCommand = client.request('command', {
      sessionId: sessionId(opened),
      command: { type: 'hold_test' },
    })
    await new Promise((resolve) => setTimeout(resolve, 25))

    const restart = await client.request('restart', {})
    assert.equal(restart.ok, false)
    assert.match(restart.error ?? '', /Active Pi work/)
    assert.equal((await pendingCommand).ok, true)

    assert.equal(
      (await client.request('command', {
        sessionId: sessionId(opened),
        command: { type: 'prompt', message: 'Test' },
      }))
        .ok,
      true,
    )
    const activeSessions = await client.request('list', {})
    assert.equal(sessionStatus(activeSessions, sessionId(opened)), 'running')
    const activeRestart = await client.request('restart', {})
    assert.equal(activeRestart.ok, false)
    assert.match(activeRestart.error ?? '', /Active Pi work/)

    assert.equal(
      (await client.request('command', {
        sessionId: sessionId(opened),
        command: { type: 'prompt', message: '/handled' },
      }))
        .ok,
      true,
    )
    const settledSessions = await client.request('list', {})
    assert.equal(sessionStatus(settledSessions, sessionId(opened)), 'idle')
    const settledRestart = await client.request('restart', {})
    assert.equal(settledRestart.ok, true)
    await once(manager, 'exit')
    assert.equal(manager.exitCode, 75)
  } finally {
    client.close()
    if (manager.exitCode === null) {
      await stopChild(manager)
    }
    await rm(directory, { force: true, recursive: true })
  }
})

test(
  'accepts commands after an event emitted before Pi finishes starting',
  { timeout: 10_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-manager-'))
    const port = 45_000 + (process.pid % 10_000)
    await writeFakePi(directory, true)
    const manager = spawn(process.execPath, ['server/manager.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        PI_LIVECRAFT_MANAGER_PORT: String(port),
      },
      stdio: 'ignore',
    })
    const client = await connectManager(port)
    try {
      const startupEvent = client.waitForEvent((event) => event.event === 'pi')
      const opening = client.request('open', {
        cwd: process.cwd(),
        name: 'Archived',
        sessionPath: join(directory, 'archived.jsonl'),
      })
      const event = await startupEvent
      const command = await client.request('command', {
        sessionId: event.sessionId,
        command: { type: 'get_commands' },
      })
      assert.equal(command.ok, true)
      await opening
    } finally {
      client.close()
      await stopChild(manager)
      await rm(directory, { force: true, recursive: true })
    }
  },
)

test('completes a manual compact without timeout', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-manager-'))
  const port = 45_000 + (process.pid % 10_000)
  await writeFakePi(directory)
  const manager = spawn(process.execPath, ['server/manager.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${directory}${delimiter}${process.env.PATH}`,
      PI_LIVECRAFT_MANAGER_PORT: String(port),
    },
    stdio: 'ignore',
  })
  const client = await connectManager(port)
  try {
    const opened = await client.request('open', {
      cwd: process.cwd(),
      name: 'Active',
      sessionPath: join(directory, 'active.jsonl'),
    })
    const compactionStart = client.waitForEvent((event) => event.event === 'pi')
    const compactResponse = await client.request('command', {
      sessionId: sessionId(opened),
      command: { type: 'compact' },
    })
    assert.equal(compactResponse.ok, true)
    const startEvent = await compactionStart
    assert.equal(isObject(startEvent.data) && startEvent.data.type, 'compaction_start')
  } finally {
    client.close()
    await stopChild(manager)
    await rm(directory, { force: true, recursive: true })
  }
})

test('restarts an exited Pi session when reopening it', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-manager-'))
  const port = 45_000 + (process.pid % 10_000)
  await writeFakePi(directory)
  const manager = spawn(process.execPath, ['server/manager.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${directory}${delimiter}${process.env.PATH}`,
      PI_LIVECRAFT_MANAGER_PORT: String(port),
    },
    stdio: 'ignore',
  })
  const client = await connectManager(port)
  try {
    const first = await client.request('open', {
      cwd: process.cwd(),
      name: 'Archived',
      sessionPath: join(directory, 'archived.jsonl'),
    })
    assert.equal(first.ok, true)

    const stopped = await client.request('command', {
      sessionId: sessionId(first),
      command: { type: 'quit_test' },
    })
    assert.equal(stopped.ok, false)

    const reopened = await client.request('open', {
      cwd: process.cwd(),
      name: 'Archived',
      sessionPath: join(directory, 'archived.jsonl'),
    })
    assert.equal(reopened.ok, true)
    assert.notEqual(sessionId(reopened), sessionId(first))
  } finally {
    client.close()
    await stopChild(manager)
    await rm(directory, { force: true, recursive: true })
  }
})

test('improves a prompt with the cheapest isolated model', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-manager-'))
  const port = 45_000 + (process.pid % 10_000)
  await writeFakePi(directory)
  const manager = spawn(process.execPath, ['server/manager.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${directory}${delimiter}${process.env.PATH}`,
      PI_LIVECRAFT_MANAGER_PORT: String(port),
    },
    stdio: 'ignore',
  })
  const client = await connectManager(port)
  try {
    const opened = await client.request('open', {
      cwd: process.cwd(),
      name: 'Active',
      sessionPath: join(directory, 'active.jsonl'),
    })
    const improved = await client.request('improve_prompt', {
      sessionId: sessionId(opened),
      prompt: 'Fix it',
    })
    assert.deepEqual(improved.data, {
      prompt: 'Fix the failing behavior and validate the result.',
      cost: 0.0042,
    })
  } finally {
    client.close()
    await stopChild(manager)
    await rm(directory, { force: true, recursive: true })
  }
})

test('improves a prompt with a direction preset', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-manager-'))
  const port = 45_000 + (process.pid % 10_000)
  await writeFakePi(directory)
  const manager = spawn(process.execPath, ['server/manager.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${directory}${delimiter}${process.env.PATH}`,
      PI_LIVECRAFT_MANAGER_PORT: String(port),
    },
    stdio: 'ignore',
  })
  const client = await connectManager(port)
  try {
    const opened = await client.request('open', {
      cwd: process.cwd(),
      name: 'Active',
      sessionPath: join(directory, 'active.jsonl'),
    })
    const improved = await client.request('improve_prompt', {
      sessionId: sessionId(opened),
      prompt: 'Fix it',
      direction: 'ideate',
    })
    assert.deepEqual(improved.data, {
      prompt: 'Fix the failing behavior and validate the result.',
      cost: 0.0042,
    })
  } finally {
    client.close()
    await stopChild(manager)
    await rm(directory, { force: true, recursive: true })
  }
})

async function writeFakePi(directory: string, emitStartupEvent = false): Promise<void> {
  const windowsTargetDirectory = join(
    directory,
    'node_modules/@earendil-works/pi-coding-agent/dist',
  )
  const scriptPath = process.platform === 'win32'
    ? join(windowsTargetDirectory, 'cli.mjs')
    : join(directory, 'fake-pi.mjs')
  const launcherPath = join(directory, process.platform === 'win32' ? 'pi.ps1' : 'pi')
  if (process.platform === 'win32') await mkdir(windowsTargetDirectory, { recursive: true })
  await writeFile(
    scriptPath,
    `import readline from 'node:readline'
const isolated = process.argv.includes('--no-session')
const sessionPath = process.argv[process.argv.indexOf('--session') + 1]
const expectedExtension = ${
      JSON.stringify(join(process.cwd(), 'pi-extensions/ask-user-question.ts'))
    }
const extensionIndex = process.argv.indexOf('--extension')
if (isolated) {
  const agentDir = process.env.PI_CODING_AGENT_DIR
  if (!agentDir || !agentDir.includes('livecraft-isolated')) throw new Error('PI_CODING_AGENT_DIR must point to an isolated profile, got ' + agentDir)
  for (const flag of ['--no-tools', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files']) {
    if (!process.argv.includes(flag)) throw new Error('Missing isolation flag: ' + flag)
  }
  if (extensionIndex !== -1) throw new Error('Invalid isolated extension')
  if (process.argv[process.argv.indexOf('--thinking') + 1] !== 'off') throw new Error('Thinking is enabled')
  const systemPrompt = process.argv[process.argv.indexOf('--system-prompt') + 1]
  if (!systemPrompt.includes('task editor')) throw new Error('Missing task editor system prompt')
  if (!systemPrompt.includes('Add no new facts')) throw new Error('Missing no-invention rule')
  if (!systemPrompt.includes('direct instructions')) throw new Error('Missing actionable-rewrite rule')
  if (!systemPrompt.includes('return it unchanged')) throw new Error('Missing unchanged-prompt rule')
} else if (extensionIndex === -1 || process.argv[extensionIndex + 1] !== expectedExtension) {
  throw new Error('Missing ask-user-question extension')
}
const emitStartupEvent = ${emitStartupEvent}
let streaming = false
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line)
  if (command.type === 'quit_test') process.exit(0)
  if (!isolated && command.type === 'hold_test') {
    setTimeout(() => console.log(JSON.stringify({ type: 'response', id: command.id, success: true, data: {} })), 150)
    return
  }
  if (!isolated && command.type === 'compact') {
    console.log(JSON.stringify({ type: 'compaction_start' }))
    setTimeout(() => {
      console.log(JSON.stringify({ type: 'response', id: command.id, success: true, data: {} }))
      setTimeout(() => console.log(JSON.stringify({ type: 'compaction_end' })), 5)
    }, 50)
    return
  }
  if (isolated && command.type === 'get_available_models') {
    console.log(JSON.stringify({ type: 'response', id: command.id, success: true, data: { models: [
      { id: 'expensive', provider: 'test', reasoning: false, cost: { input: 1, output: 5 } },
      { id: 'cheap', provider: 'test', reasoning: false, cost: { input: 2, output: 1 } }
    ] } }))
    return
  }
  if (isolated && command.type === 'set_model' && command.modelId !== 'cheap') throw new Error('Wrong model selected')
  if (isolated && command.type === 'prompt') {
    if (command.message !== '<user_prompt>\\nFix it\\n</user_prompt>') throw new Error('Prompt was not delimited')
    console.log(JSON.stringify({ type: 'response', id: command.id, success: true }))
    setTimeout(() => console.log(JSON.stringify({ type: 'agent_settled' })), 5)
    return
  }
  if (isolated && command.type === 'get_session_stats') {
    console.log(JSON.stringify({ type: 'response', id: command.id, success: true, data: { cost: 0.0042 } }))
    return
  }
  if (isolated && command.type === 'get_messages') {
    console.log(JSON.stringify({ type: 'response', id: command.id, success: true, data: { messages: [
      { role: 'assistant', content: [{ type: 'text', text: 'Fix the failing behavior and validate the result.' }] }
    ] } }))
    return
  }
  if (!isolated && command.type === 'prompt') {
    if (command.message === '/select') {
      console.log(JSON.stringify({ type: 'extension_ui_request', id: 'select-test', method: 'select', title: 'Select an agent', options: ['worker'] }))
    } else {
      streaming = command.message !== '/handled'
    }
    console.log(JSON.stringify({ type: 'response', id: command.id, success: true, data: {} }))
    return
  }
  const data = command.type === 'get_state' ? { sessionFile: sessionPath, isStreaming: streaming, isCompacting: false, pendingMessageCount: 0 } : {}
  if (command.type === 'get_state' && emitStartupEvent) {
    console.log(JSON.stringify({ type: 'extension_ui_request', method: 'notify', message: 'Starting' }))
    setTimeout(() => console.log(JSON.stringify({ type: 'response', id: command.id, success: true, data })), 100)
    return
  }
  console.log(JSON.stringify({ type: 'response', id: command.id, success: true, data }))
})
`,
  )
  if (process.platform === 'win32') {
    await writeFile(
      launcherPath,
      '& "node$exe" "$basedir/node_modules/@earendil-works/pi-coding-agent/dist/cli.mjs" $args\r\n',
    )
  } else {
    await writeFile(launcherPath, `#!/usr/bin/env node\nimport './fake-pi.mjs'\n`)
    await chmod(launcherPath, 0o755)
  }
}

interface ManagerResponse {
  kind: 'response'
  id: string
  ok: boolean
  data?: unknown
  error?: string
}

interface ManagerEvent {
  kind: 'event'
  event: string
  sessionId: string
  data?: unknown
}

async function connectManager(
  port: number,
): Promise<
  {
    request: (action: string, fields: Record<string, unknown>) => Promise<ManagerResponse>
    waitForEvent: (predicate: (event: ManagerEvent) => boolean) => Promise<ManagerEvent>
    close: () => void
  }
> {
  const socket = await connectWithRetry(port)
  let buffer = ''
  let requestId = 0
  const pending = new Map<string, (response: ManagerResponse) => void>()
  const events: ManagerEvent[] = []
  const eventWaiters = new Set<() => void>()
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line) continue
      const response: unknown = JSON.parse(line)
      if (isManagerResponse(response)) {
        pending.get(response.id)?.(response)
        pending.delete(response.id)
        continue
      }
      if (isManagerEvent(response)) {
        events.push(response)
        for (const notify of eventWaiters) notify()
      }
    }
  })

  return {
    request(action, fields) {
      const id = String(++requestId)
      return new Promise((resolve) => {
        pending.set(id, resolve)
        socket.write(`${JSON.stringify({ id, action, ...fields })}\n`)
      })
    },
    waitForEvent(predicate) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          eventWaiters.delete(check)
          reject(new Error('Timed out waiting for manager event'))
        }, 5_000)
        function check(): void {
          const index = events.findIndex(predicate)
          if (index === -1) return
          clearTimeout(timeout)
          eventWaiters.delete(check)
          resolve(events.splice(index, 1)[0])
        }
        eventWaiters.add(check)
        check()
      })
    },
    close: () => socket.end(),
  }
}

/** Waits for asynchronous process output without relying on a fixed startup duration. */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for condition')
}

async function connectWithRetry(port: number): Promise<Socket> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await new Promise<Socket>((resolve, reject) => {
        const socket = connect({ host: '127.0.0.1', port })
        socket.once('connect', () => resolve(socket))
        socket.once('error', reject)
      })
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw new Error('Pi manager did not start')
}

function sessionId(response: ManagerResponse): string {
  if (!isObject(response.data) || typeof response.data.id !== 'string')
    throw new Error('Invalid session response')
  return response.data.id
}

function sessionStatus(response: ManagerResponse, id: string): unknown {
  if (!Array.isArray(response.data)) throw new Error('Invalid sessions response')
  const session = response.data.find((value) => isObject(value) && value.id === id)
  return isObject(session) ? session.status : undefined
}

function sessionPendingUi(response: ManagerResponse, id: string): unknown[] {
  if (!Array.isArray(response.data)) throw new Error('Invalid sessions response')
  const session = response.data.find((value) => isObject(value) && value.id === id)
  if (!isObject(session) || !Array.isArray(session.pendingUi)) return []
  return session.pendingUi
}

function isManagerResponse(value: unknown): value is ManagerResponse {
  return isObject(value) && value.kind === 'response' && typeof value.id === 'string'
    && typeof value.ok === 'boolean'
}

function isManagerEvent(value: unknown): value is ManagerEvent {
  return isObject(value) && value.kind === 'event' && typeof value.event === 'string'
    && typeof value.sessionId === 'string'
}
/** Stops the complete test process tree on Windows, where child signals do not propagate. */
async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
    })
    const [code] = await once(killer, 'exit')
    if (code !== 0) child.kill('SIGKILL')
  } else child.kill('SIGTERM')
  await exited
}

function once(
  process: ReturnType<typeof spawn>,
  event: 'exit',
): Promise<[code: number | null, signal: NodeJS.Signals | null]> {
  return new Promise((resolve) => process.once(event, (code, signal) => resolve([code, signal])))
}
