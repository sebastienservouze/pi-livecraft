import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  listWorkspaceEntries,
  WorkspaceEntriesError,
} from '../server/features/explorer/workspace-entries.ts'

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pi-explorer-'))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'index.ts'), 'export {}\n')
  await writeFile(join(root, 'readme.md'), '# hello\n')
  return root
}

test('liste les dossiers avant les fichiers avec leur taille', async () => {
  const root = await workspace()
  const listing = await listWorkspaceEntries(root)

  assert.equal(listing.relativePath, '')
  assert.equal(listing.parentRelativePath, null)
  assert.deepEqual(listing.entries.map((entry) => entry.name), ['src', 'readme.md'])
  assert.equal(listing.entries[0].kind, 'directory')
  assert.equal(listing.entries[0].size, null)
  assert.equal(listing.entries[1].size, '# hello\n'.length)
})

test('navigue dans un sous-dossier et expose son parent', async () => {
  const root = await workspace()
  const listing = await listWorkspaceEntries(root, 'src')

  assert.equal(listing.relativePath, 'src')
  assert.equal(listing.parentRelativePath, '')
  assert.deepEqual(listing.entries.map((entry) => entry.relativePath), ['src/index.ts'])
})

test('refuse de sortir du répertoire de travail', async () => {
  const root = await workspace()
  await assert.rejects(
    () => listWorkspaceEntries(root, '..'),
    (error: unknown) =>
      error instanceof WorkspaceEntriesError && error.status === 403
      && error.message === 'Path must be inside the working directory',
  )
  await assert.rejects(
    () => listWorkspaceEntries(root, '/etc'),
    (error: unknown) => error instanceof WorkspaceEntriesError && error.status === 400,
  )
})

test('refuse un lien symbolique qui échappe au répertoire de travail', async () => {
  const root = await workspace()
  const outside = await mkdtemp(join(tmpdir(), 'pi-outside-'))
  await symlink(outside, join(root, 'escape'))

  await assert.rejects(
    () => listWorkspaceEntries(root, 'escape'),
    (error: unknown) => error instanceof WorkspaceEntriesError && error.status === 403,
  )
})

test('signale un dossier absent et un chemin de fichier', async () => {
  const root = await workspace()
  await assert.rejects(
    () => listWorkspaceEntries(root, 'missing'),
    (error: unknown) => error instanceof WorkspaceEntriesError && error.status === 404,
  )
  await assert.rejects(
    () => listWorkspaceEntries(root, 'readme.md'),
    (error: unknown) => error instanceof WorkspaceEntriesError && error.status === 400,
  )
})
