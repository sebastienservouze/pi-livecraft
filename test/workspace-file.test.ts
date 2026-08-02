import assert from 'node:assert/strict'
import { basename } from 'node:path'
import test from 'node:test'
import {
  readWorkspaceFile,
  resolveWorkspaceFilePath,
  WorkspaceFileError,
} from '../server/workspace-file.ts'

test('reads a text file from the workspace and rejects its root', async () => {
  const path = await resolveWorkspaceFilePath(process.cwd(), 'package.json')
  const file = await readWorkspaceFile(process.cwd(), 'package.json')

  assert.equal(path, file.path)
  assert.equal(basename(file.path), 'package.json')
  assert.match(file.content, /"name": "pi-livecraft"/)
  await assert.rejects(readWorkspaceFile(process.cwd(), '.'), (error: unknown) => {
    assert.equal(error instanceof WorkspaceFileError, true)
    assert.equal((error as WorkspaceFileError).status, 403)
    return true
  })
})
