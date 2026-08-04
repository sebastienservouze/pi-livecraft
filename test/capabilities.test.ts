import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { discoverCapabilities, resolvePiAgentDirectory } from '../server/capabilities.ts'

async function fixture(): Promise<{ agentDir: string; cwd: string }> {
  return {
    agentDir: await mkdtemp(join(tmpdir(), 'pi-agent-')),
    cwd: await mkdtemp(join(tmpdir(), 'pi-workspace-')),
  }
}

test('resolves Pi agent directory with Pi environment precedence', () => {
  const homeDirectory = join('home', 'user')
  const agentDirectory = join('infrastructure', '.pi', 'agent')

  assert.equal(
    resolvePiAgentDirectory({ PI_CODING_AGENT_DIR: agentDirectory }, homeDirectory),
    agentDirectory,
  )
  assert.equal(
    resolvePiAgentDirectory({}, homeDirectory),
    join(homeDirectory, '.pi', 'agent'),
  )
})

test('discovers a skill from SKILL.md frontmatter', async () => {
  const { agentDir, cwd } = await fixture()
  const skillDirectory = join(agentDir, 'skills', 'creator')
  await mkdir(skillDirectory, { recursive: true })
  await writeFile(
    join(skillDirectory, 'SKILL.md'),
    '---\nname: creatorskill\ndescription: Creates things.\n---\n\nBody text.\n',
  )

  const inventory = await discoverCapabilities(cwd, agentDir)
  assert.equal(inventory.skills.length, 1)
  assert.deepEqual(
    { name: inventory.skills[0].name, description: inventory.skills[0].description },
    { name: 'creatorskill', description: 'Creates things.' },
  )
  assert.equal(inventory.skills[0].scope, 'user')
  assert.equal(inventory.skills[0].origin, 'Pi agent')
  assert.equal(inventory.skills[0].enabled, true)
  assert.equal(inventory.skillsError, undefined)
})

test('discovers an extension subdirectory', async () => {
  const { agentDir, cwd } = await fixture()
  const extensionDirectory = join(cwd, '.pi', 'extensions', 'browser-tools')
  await mkdir(extensionDirectory, { recursive: true })
  await writeFile(
    join(extensionDirectory, 'package.json'),
    JSON.stringify({ description: 'Browser automation tools.' }),
  )

  const inventory = await discoverCapabilities(cwd, agentDir)
  assert.equal(inventory.extensions.length, 1)
  assert.deepEqual(
    {
      name: inventory.extensions[0].name,
      description: inventory.extensions[0].description,
      scope: inventory.extensions[0].scope,
      origin: inventory.extensions[0].origin,
    },
    {
      name: 'browser-tools',
      description: 'Browser automation tools.',
      scope: 'project',
      origin: 'Project (.pi)',
    },
  )
  assert.equal(inventory.extensionsError, undefined)
})

test('treats a missing root as an empty list without an error', async () => {
  const { agentDir, cwd } = await fixture()

  const inventory = await discoverCapabilities(cwd, agentDir)
  assert.deepEqual(inventory.skills, [])
  assert.deepEqual(inventory.extensions, [])
  assert.equal(inventory.skillsError, undefined)
  assert.equal(inventory.extensionsError, undefined)
})

test('fails closed when a skills root is a file instead of a directory', async () => {
  const { agentDir, cwd } = await fixture()
  await mkdir(agentDir, { recursive: true })
  await writeFile(join(agentDir, 'skills'), 'not a directory')

  const inventory = await discoverCapabilities(cwd, agentDir)
  assert.deepEqual(inventory.skills, [])
  assert.equal(typeof inventory.skillsError, 'string')
  assert.ok(inventory.skillsError && inventory.skillsError.length > 0)
})
