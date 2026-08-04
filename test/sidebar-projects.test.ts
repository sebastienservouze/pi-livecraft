import assert from 'node:assert/strict'
import test from 'node:test'
import type { RecentSession, SessionSummary } from '../shared/types.ts'
import { groupProjects, projectLabel } from '../src/features/workspace/sidebar-projects.ts'

const recent = (over: Partial<RecentSession>): RecentSession => ({
  id: 'r',
  cwd: '/Users/dev/alpha',
  name: 'A thread',
  sessionPath: '/sessions/a.jsonl',
  updatedAt: 100,
  ...over,
})

const live = (over: Partial<SessionSummary>): SessionSummary => ({
  id: 's',
  cwd: '/Users/dev/beta',
  name: 'Live thread',
  sessionPath: '/sessions/live.jsonl',
  status: 'running',
  pendingUi: [],
  ...over,
})

const base = {
  archivedProjects: [] as string[],
}

test('projectLabel uses the trailing path segment', () => {
  assert.equal(projectLabel('/Users/dev/llm-collab'), 'llm-collab')
  assert.equal(projectLabel('/Users/dev/nuvyr_app/'), 'nuvyr_app')
})

test('separates two projects into independent sections', () => {
  const groups = groupProjects({
    recentSessions: [recent({})],
    sessions: [live({})],
    activeWorkspacePath: '/Users/dev/alpha',
    ...base,
  })
  assert.deepEqual(groups.map((group) => group.path), ['/Users/dev/alpha', '/Users/dev/beta'])
  assert.equal(groups[0].threads.length, 1)
  assert.equal(groups[1].threads.length, 1)
  assert.equal(groups[1].activeCount, 1)
})

test('always shows the active workspace even when it has no threads', () => {
  const groups = groupProjects({
    recentSessions: [],
    sessions: [],
    activeWorkspacePath: '/Users/dev/empty',
    ...base,
  })
  assert.deepEqual(groups.map((group) => group.path), ['/Users/dev/empty'])
  assert.equal(groups[0].threads.length, 0)
})

test('a dragged project order leads, unordered projects follow default order', () => {
  const groups = groupProjects({
    recentSessions: [recent({ updatedAt: 10 })],
    sessions: [live({ cwd: '/Users/dev/beta' })],
    activeWorkspacePath: '/Users/dev/alpha',
    projectOrder: ['/Users/dev/beta'],
    archivedProjects: [],
  })
  assert.deepEqual(groups.map((group) => group.path), ['/Users/dev/beta', '/Users/dev/alpha'])
})

test('archived projects are hidden from the grouping', () => {
  const groups = groupProjects({
    recentSessions: [recent({})],
    sessions: [live({})],
    activeWorkspacePath: '/Users/dev/alpha',
    archivedProjects: ['/Users/dev/beta'],
  })
  assert.deepEqual(groups.map((group) => group.path), ['/Users/dev/alpha'])
})

test('orders threads with live sessions first, then by recency', () => {
  const groups = groupProjects({
    recentSessions: [
      recent({ sessionPath: '/sessions/old.jsonl', updatedAt: 50 }),
      recent({ sessionPath: '/sessions/newer.jsonl', updatedAt: 300 }),
    ],
    sessions: [live({ cwd: '/Users/dev/alpha', sessionPath: '/sessions/live.jsonl' })],
    activeWorkspacePath: '/Users/dev/alpha',
    ...base,
  })
  const [alpha] = groups
  assert.deepEqual(alpha.threads.map((thread) => thread.sessionPath), [
    '/sessions/live.jsonl',
    '/sessions/newer.jsonl',
    '/sessions/old.jsonl',
  ])
})

test('pins and archives session rows independently from their project', () => {
  const groups = groupProjects({
    recentSessions: [
      recent({ sessionPath: '/sessions/pinned.jsonl', updatedAt: 10 }),
      recent({ sessionPath: '/sessions/archived.jsonl', updatedAt: 20 }),
    ],
    sessions: [],
    activeWorkspacePath: '/Users/dev/alpha',
    archivedProjects: [],
    pinnedSessions: ['/sessions/pinned.jsonl'],
    archivedSessions: ['/sessions/archived.jsonl'],
  })
  const alpha = groups.find((group) => group.path === '/Users/dev/alpha')
  assert.equal(alpha?.threads[0]?.pinned, true)
  assert.deepEqual(alpha?.archivedThreads.map((thread) => thread.key), [
    '/sessions/archived.jsonl',
  ])
})

test('excludes exited managed sessions from live threads', () => {
  const groups = groupProjects({
    recentSessions: [],
    sessions: [live({ cwd: '/Users/dev/gamma', status: 'exited' })],
    activeWorkspacePath: '/Users/dev/alpha',
    ...base,
  })
  assert.deepEqual(groups.map((group) => group.path), ['/Users/dev/alpha'])
})

test('carries session model metadata onto threads from history and live sessions', () => {
  const groups = groupProjects({
    recentSessions: [recent({ model: { provider: 'zai', id: 'glm-5.2' }, thinkingLevel: 'high' })],
    sessions: [
      live({
        activeAgent: 'Glim (glmpi)',
        model: { provider: 'zai', id: 'glm-5.2', name: 'GLM-5.2' },
      }),
    ],
    activeWorkspacePath: '/Users/dev/alpha',
    ...base,
  })
  const alpha = groups.find((group) => group.path === '/Users/dev/alpha')
  const beta = groups.find((group) => group.path === '/Users/dev/beta')
  assert.deepEqual(alpha?.threads[0]?.model, { provider: 'zai', id: 'glm-5.2' })
  assert.equal(beta?.threads[0]?.worker, 'Glim (glmpi)')
  assert.equal(beta?.threads[0]?.model?.name, 'GLM-5.2')
  assert.equal(alpha?.threads[0]?.thinkingLevel, 'high')
})
