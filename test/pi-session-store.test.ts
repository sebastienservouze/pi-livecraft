import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import test from 'node:test'
import { listRecentPiSessions, resolvePiSessionDirectory } from '../server/pi-session-store.ts'

async function fixture(): Promise<{ directory: string; workspace: string }> {
  return {
    directory: await mkdtemp(join(tmpdir(), 'pi-sessions-')),
    workspace: await mkdtemp(join(tmpdir(), 'pi-workspace-')),
  }
}

test('resolves Pi session storage with Pi environment precedence', () => {
  const homeDirectory = join('home', 'user')
  const agentDirectory = join('infrastructure', '.pi', 'agent')
  const sessionDirectory = join('custom', 'sessions')

  assert.equal(
    resolvePiSessionDirectory({
      PI_CODING_AGENT_SESSION_DIR: sessionDirectory,
      PI_CODING_AGENT_DIR: agentDirectory,
    }, homeDirectory),
    sessionDirectory,
  )
  assert.equal(
    resolvePiSessionDirectory({ PI_CODING_AGENT_DIR: agentDirectory }, homeDirectory),
    join(agentDirectory, 'sessions'),
  )
  assert.equal(
    resolvePiSessionDirectory({}, homeDirectory),
    join(homeDirectory, '.pi', 'agent', 'sessions'),
  )
})

test('sorts canonical Pi sessions by their last message timestamp', async () => {
  const { directory, workspace } = await fixture()
  const sessions = join(directory, 'project')
  await mkdir(sessions)
  await writeSession(
    join(sessions, 'older.jsonl'),
    `${workspace}${sep}`,
    'older',
    'Older session',
    undefined,
    '2026-07-19T11:00:00.000Z',
  )
  await writeSession(
    join(sessions, 'newer.jsonl'),
    workspace,
    'newer',
    'Newer session',
    'Renamed session',
  )
  const recent = await listRecentPiSessions(workspace, directory)
  assert.deepEqual(recent.map(({ id, name, cwd }) => ({ id, name, cwd })), [
    { id: 'older', name: 'Older session', cwd: workspace },
    { id: 'newer', name: 'Renamed session', cwd: workspace },
  ])
  assert.deepEqual(recent.map(({ sessionPath }) => sessionPath), [
    await realpath(join(sessions, 'older.jsonl')),
    await realpath(join(sessions, 'newer.jsonl')),
  ])
})

test('returns every session in the canonical working directory and omits stale cwd records', async () => {
  const { directory, workspace } = await fixture()
  await Promise.all(
    Array.from({ length: 11 }, (_, index) =>
      writeSession(
        join(directory, `${index}.jsonl`),
        workspace,
        String(index),
        `Session ${index}`,
      )),
  )
  await writeSession(join(directory, 'stale.jsonl'), join(directory, 'missing'), 'stale', 'Stale')
  assert.equal((await listRecentPiSessions(workspace, directory)).length, 11)
})

test('uses the first non-command user prompt and hides sessions without messages', async () => {
  const { directory, workspace } = await fixture()
  await writeFile(
    join(directory, 'unnamed.jsonl'),
    [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'unnamed',
        timestamp: '2026-07-19T10:00:00.000Z',
        cwd: workspace,
      }),
      JSON.stringify({ type: 'message', message: { role: 'user', content: '/agent' } }),
      JSON.stringify({
        type: 'message',
        message: { role: 'user', content: 'One two three four five six seven eight nine' },
      }),
    ]
      .join('\n'),
  )
  await writeFile(
    join(directory, 'empty.jsonl'),
    [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'empty',
        timestamp: '2026-07-19T10:00:00.000Z',
        cwd: workspace,
      }),
      JSON.stringify({ type: 'session_info', name: 'New session' }),
    ]
      .join('\n'),
  )
  const recent = await listRecentPiSessions(workspace, directory)
  assert.equal(recent.length, 1)
  assert.equal(recent[0].name, 'One two three four five six seven eight…')
})

async function writeSession(
  path: string,
  cwd: string,
  id: string,
  name: string,
  renamedName?: string,
  lastMessageTimestamp?: string,
): Promise<void> {
  const timestamp = id === 'newer' ? '2026-07-19T10:00:00.000Z' : '2026-07-19T09:00:00.000Z'
  await writeFile(
    path,
    [
      JSON.stringify({ type: 'session', version: 3, id, timestamp, cwd }),
      JSON.stringify({ type: 'session_info', name }),
      JSON.stringify({
        type: 'message',
        timestamp: lastMessageTimestamp ?? timestamp,
        message: { role: 'user', content: name },
      }),
      ...(renamedName ? [JSON.stringify({ type: 'session_info', name: renamedName })] : []),
    ]
      .join('\n'),
  )
}
