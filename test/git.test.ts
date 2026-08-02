import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import {
  commitChanges,
  discardChanges,
  discardFileChanges,
  getGitFileDiff,
  getGitSnapshot,
  mergeNumstats,
  parseGitStatus,
  pushCommits,
  resetGitCommit,
  revertGitCommit,
} from '../server/features/git/git.ts'

const execFile = promisify(execFileCallback)

test('parses Git status and combines staged and unstaged line counts', () => {
  assert.deepEqual(parseGitStatus(' M src/App.tsx\0?? new-file.ts\0R  renamed.ts\0old-name.ts\0'), [
    { path: 'src/App.tsx', status: 'modified' },
    { path: 'new-file.ts', status: 'added' },
    { path: 'renamed.ts', status: 'renamed' },
  ])

  const counts = mergeNumstats('2\t1\tsrc/App.tsx\0', '3\t0\tsrc/App.tsx\0' + '4\t0\tnew-file.ts\0')

  assert.deepEqual(counts.get('src/App.tsx'), { additions: 5, deletions: 1 })
  assert.deepEqual(counts.get('new-file.ts'), { additions: 4, deletions: 0 })
})

test('uses the destination path for renamed numstat records and preserves binary counts', () => {
  const counts = mergeNumstats('-\t-\t\0old-name.ts\0renamed.ts\0')

  assert.deepEqual(counts.get('renamed.ts'), { additions: null, deletions: null })
})

test('reports untracked files and their line additions from a worktree', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-git-'))
  try {
    await execFile('git', ['init', '--quiet'], { cwd: directory })
    await writeFile(join(directory, 'new-file.ts'), 'first line\nsecond line\n')

    const snapshot = await getGitSnapshot(directory)

    assert.equal(snapshot.repository, true)
    assert.equal(snapshot.root?.replaceAll('\\', '/'), directory.replaceAll('\\', '/'))
    assert.deepEqual(snapshot.files, [{
      path: 'new-file.ts',
      status: 'added',
      additions: 2,
      deletions: 0,
    }])
    assert.deepEqual(snapshot.commits, [])
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('returns diffs for modified and untracked files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-git-'))
  try {
    await execFile('git', ['init', '--quiet'], { cwd: directory })
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: directory })
    await execFile('git', ['config', 'user.name', 'Test User'], { cwd: directory })
    await writeFile(join(directory, 'tracked.ts'), 'before\n')
    await execFile('git', ['add', 'tracked.ts'], { cwd: directory })
    await execFile('git', ['commit', '--quiet', '-m', 'Initial commit'], { cwd: directory })
    await writeFile(join(directory, 'tracked.ts'), 'after\n')
    await writeFile(join(directory, 'new.ts'), 'new file\n')

    const modified = await getGitFileDiff(directory, 'tracked.ts')
    const added = await getGitFileDiff(directory, 'new.ts')

    assert.match(modified.diff, /-before\n\+after/)
    assert.match(added.diff, /\+new file/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('reports, resets, and reverts unpushed commits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-git-'))
  const remote = await mkdtemp(join(tmpdir(), 'pi-livecraft-git-remote-'))
  try {
    await execFile('git', ['init', '--bare', '--quiet'], { cwd: remote })
    await execFile('git', ['init', '--quiet'], { cwd: directory })
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: directory })
    await execFile('git', ['config', 'user.name', 'Test User'], { cwd: directory })
    await writeFile(join(directory, 'tracked.ts'), 'initial\n')
    await execFile('git', ['add', 'tracked.ts'], { cwd: directory })
    await execFile('git', ['commit', '--quiet', '-m', 'Initial commit'], { cwd: directory })
    await execFile('git', ['branch', '-M', 'main'], { cwd: directory })
    await execFile('git', ['remote', 'add', 'origin', remote], { cwd: directory })
    await execFile('git', ['push', '--quiet', '--set-upstream', 'origin', 'main'], {
      cwd: directory,
    })
    await writeFile(join(directory, 'tracked.ts'), 'initial\nchanged\n')
    await writeFile(join(directory, 'unpushed.ts'), 'local only\n')
    await execFile('git', ['add', 'tracked.ts', 'unpushed.ts'], { cwd: directory })
    await execFile('git', ['commit', '--quiet', '-m', 'Local commit'], { cwd: directory })
    await writeFile(join(directory, 'second.ts'), 'second commit\n')
    await execFile('git', ['add', 'second.ts'], { cwd: directory })
    await execFile('git', ['commit', '--quiet', '-m', 'Second local commit'], { cwd: directory })

    const snapshot = await getGitSnapshot(directory)

    assert.equal(snapshot.ahead, 2)
    assert.deepEqual(snapshot.commits.map(({ hash: _hash, ...commit }) => commit), [
      {
        subject: 'Second local commit',
        files: [{ path: 'second.ts', status: 'added', additions: 1, deletions: 0 }],
      },
      {
        subject: 'Local commit',
        files: [
          { path: 'tracked.ts', status: 'modified', additions: 1, deletions: 0 },
          { path: 'unpushed.ts', status: 'added', additions: 1, deletions: 0 },
        ],
      },
    ])
    assert.match(snapshot.commits[0]?.hash ?? '', /^[0-9a-f]{40}$/)

    const commit = snapshot.commits.find(({ subject }) => subject === 'Local commit')
    const diff = await getGitFileDiff(directory, 'tracked.ts', commit?.hash)
    assert.match(diff.diff, /\+changed/)

    await assert.rejects(
      resetGitCommit(directory, commit?.hash ?? ''),
      /Only the latest unpushed commit/,
    )
    await resetGitCommit(directory, snapshot.commits[0]?.hash ?? '')
    const reset = await getGitSnapshot(directory)
    const tracked = await execFile('git', ['show', 'HEAD:tracked.ts'], { cwd: directory })

    assert.equal(reset.ahead, 1)
    assert.deepEqual(reset.commits.map(({ subject }) => subject), ['Local commit'])
    assert.deepEqual(reset.files.map(({ path, status }) => ({ path, status })), [
      { path: 'second.ts', status: 'added' },
    ])
    assert.equal(tracked.stdout, 'initial\nchanged\n')

    await execFile('git', ['add', '-A'], { cwd: directory })
    await execFile('git', ['commit', '--quiet', '-m', 'Restored local changes'], { cwd: directory })
    const restored = await getGitSnapshot(directory)
    await revertGitCommit(directory, restored.commits[0]?.hash ?? '')
    const reverted = await getGitSnapshot(directory)

    assert.equal(reverted.ahead, 3)
    assert.equal(reverted.files.length, 0)
    assert.match(reverted.commits[0]?.subject ?? '', /^Revert "Restored local changes"$/)
  } finally {
    await rm(directory, { force: true, recursive: true })
    await rm(remote, { force: true, recursive: true })
  }
})

test('commits without pushing, pushes separately, and discards changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-git-'))
  const remote = await mkdtemp(join(tmpdir(), 'pi-livecraft-git-remote-'))
  try {
    await execFile('git', ['init', '--bare', '--quiet'], { cwd: remote })
    await execFile('git', ['init', '--quiet'], { cwd: directory })
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: directory })
    await execFile('git', ['config', 'user.name', 'Test User'], { cwd: directory })
    await writeFile(join(directory, 'initial.ts'), 'hello\n')
    await execFile('git', ['add', 'initial.ts'], { cwd: directory })
    await execFile('git', ['commit', '--quiet', '-m', 'Initial'], { cwd: directory })
    await execFile('git', ['branch', '-M', 'main'], { cwd: directory })
    await execFile('git', ['remote', 'add', 'origin', remote], { cwd: directory })
    await execFile('git', ['push', '--quiet', '--set-upstream', 'origin', 'main'], {
      cwd: directory,
    })

    // Commit only — does not push
    await writeFile(join(directory, 'initial.ts'), 'hello\nworld\n')
    await writeFile(join(directory, 'new.ts'), 'new file\n')
    await commitChanges(directory, 'Local only')

    let snapshot = await getGitSnapshot(directory)
    assert.equal(snapshot.files.length, 0)
    assert.equal(snapshot.ahead, 1)
    assert.equal(snapshot.commits[0].subject, 'Local only')

    // Push the commit
    const pushResult = await pushCommits(directory)
    assert.equal(pushResult.pushed, true)

    snapshot = await getGitSnapshot(directory)
    assert.equal(snapshot.ahead, 0)

    // Discard uncommitted changes including new files
    await writeFile(join(directory, 'modified.ts'), 'dirty\n')
    await writeFile(join(directory, 'untracked.ts'), 'new\n')
    await execFile('git', ['add', 'modified.ts'], { cwd: directory })

    let dirty = await getGitSnapshot(directory)
    assert.equal(dirty.files.length, 2)

    await discardChanges(directory)

    dirty = await getGitSnapshot(directory)
    assert.equal(dirty.files.length, 0)
  } finally {
    await rm(directory, { force: true, recursive: true })
    await rm(remote, { force: true, recursive: true })
  }
})

test('discards only the selected file, including renamed and untracked files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-git-'))
  try {
    await execFile('git', ['init', '--quiet'], { cwd: directory })
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: directory })
    await execFile('git', ['config', 'user.name', 'Test User'], { cwd: directory })
    await writeFile(join(directory, 'first.ts'), 'first\n')
    await writeFile(join(directory, 'second.ts'), 'second\n')
    await execFile('git', ['add', '.'], { cwd: directory })
    await execFile('git', ['commit', '--quiet', '-m', 'Initial'], { cwd: directory })
    await writeFile(join(directory, 'first.ts'), 'changed\n')
    await writeFile(join(directory, 'second.ts'), 'also changed\n')
    await writeFile(join(directory, 'new.ts'), 'new\n')

    await discardFileChanges(directory, 'first.ts')
    let snapshot = await getGitSnapshot(directory)
    assert.deepEqual(snapshot.files.map(({ path }) => path), ['second.ts', 'new.ts'])
    assert.equal(
      (await readFile(join(directory, 'first.ts'), 'utf8')).replaceAll('\r\n', '\n'),
      'first\n',
    )

    await discardFileChanges(directory, 'new.ts')
    await execFile('git', ['checkout', '--', 'second.ts'], { cwd: directory })
    await execFile('git', ['mv', 'second.ts', 'renamed.ts'], { cwd: directory })
    await discardFileChanges(directory, 'renamed.ts')
    snapshot = await getGitSnapshot(directory)
    assert.equal(snapshot.files.length, 0)
    assert.equal(
      (await readFile(join(directory, 'second.ts'), 'utf8')).replaceAll('\r\n', '\n'),
      'second\n',
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('rejects commit without changes or message', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-git-'))
  try {
    await execFile('git', ['init', '--quiet'], { cwd: directory })
    await assert.rejects(commitChanges(directory, 'Nothing'), /no changes/)
    await writeFile(join(directory, 'file.ts'), 'content\n')
    await assert.rejects(commitChanges(directory, '  '), /commit message/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('rejects push without ahead commits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-git-'))
  try {
    await execFile('git', ['init', '--quiet'], { cwd: directory })
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: directory })
    await execFile('git', ['config', 'user.name', 'Test User'], { cwd: directory })
    await writeFile(join(directory, 'file.ts'), 'content\n')
    await execFile('git', ['add', 'file.ts'], { cwd: directory })
    await execFile('git', ['commit', '--quiet', '-m', 'Initial'], { cwd: directory })
    await assert.rejects(pushCommits(directory), /no commits to push/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
