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
  pinnedProjects: [] as string[],
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

test('pinned projects lead and are marked, surviving refresh order', () => {
  const groups = groupProjects({
    recentSessions: [recent({ updatedAt: 10 })],
    sessions: [live({ cwd: '/Users/dev/beta' })],
    activeWorkspacePath: '/Users/dev/alpha',
    pinnedProjects: ['/Users/dev/beta'],
    archivedProjects: [],
  })
  assert.equal(groups[0].path, '/Users/dev/beta')
  assert.equal(groups[0].pinned, true)
})

test('archived projects are hidden from the grouping', () => {
  const groups = groupProjects({
    recentSessions: [recent({})],
    sessions: [live({})],
    activeWorkspacePath: '/Users/dev/alpha',
    pinnedProjects: [],
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

test('excludes exited managed sessions from live threads', () => {
  const groups = groupProjects({
    recentSessions: [],
    sessions: [live({ cwd: '/Users/dev/gamma', status: 'exited' })],
    activeWorkspacePath: '/Users/dev/alpha',
    ...base,
  })
  assert.deepEqual(groups.map((group) => group.path), ['/Users/dev/alpha'])
})
