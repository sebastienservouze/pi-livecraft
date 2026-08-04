import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CapabilityEntry, CapabilityInventory } from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'

/** Resolves Pi's agent directory using its configured profile before the default profile. */
export function resolvePiAgentDirectory(
  environment: { PI_CODING_AGENT_DIR?: string },
  homeDirectory: string,
): string {
  return environment.PI_CODING_AGENT_DIR ?? join(homeDirectory, '.pi', 'agent')
}

const agentDirectory = resolvePiAgentDirectory(process.env, homedir())

const MAX_ENTRIES = 200
const MAX_FILE_BYTES = 64 * 1024

/** Discovers installed Pi skills and extensions across the user and project scopes. */
export async function discoverCapabilities(
  cwd: string,
  agentDir = agentDirectory,
): Promise<CapabilityInventory> {
  const [skillsResult, extensionsResult] = await Promise.all([
    discoverSurface(
      [
        { root: join(agentDir, 'skills'), scope: 'user' },
        { root: join(cwd, '.pi', 'skills'), scope: 'project' },
      ],
      readSkill,
    ),
    discoverSurface(
      [
        { root: join(agentDir, 'extensions'), scope: 'user' },
        { root: join(cwd, '.pi', 'extensions'), scope: 'project' },
      ],
      readExtension,
    ),
  ])

  const inventory: CapabilityInventory = {
    skills: skillsResult.entries,
    extensions: extensionsResult.entries,
  }
  if (skillsResult.error) inventory.skillsError = skillsResult.error
  if (extensionsResult.error) inventory.extensionsError = extensionsResult.error
  return inventory
}

interface ScopedRoot {
  root: string
  scope: 'user' | 'project'
}

/** Reads every root for a capability surface, keeping partial results when one root fails. */
async function discoverSurface(
  roots: ScopedRoot[],
  readEntry: (path: string, name: string, scope: 'user' | 'project') => Promise<CapabilityEntry>,
): Promise<{ entries: CapabilityEntry[]; error?: string }> {
  const entries: CapabilityEntry[] = []
  let error: string | undefined
  for (const { root, scope } of roots) {
    let names: string[]
    try {
      names = await readDirectoryNames(root)
    } catch (cause) {
      if (isNotFound(cause)) continue
      error = errorMessage(cause)
      continue
    }
    for (const name of names.slice(0, MAX_ENTRIES)) {
      entries.push(await readEntry(join(root, name), name, scope))
    }
  }
  return { entries: entries.sort((left, right) => left.name.localeCompare(right.name)), error }
}

/** Lists only subdirectory names, treating a non-directory root as a discovery failure. */
async function readDirectoryNames(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

/** Reads a skill directory's SKILL.md frontmatter, falling back to the directory name. */
async function readSkill(
  path: string,
  name: string,
  scope: 'user' | 'project',
): Promise<CapabilityEntry> {
  const frontmatter = await readFrontmatter(join(path, 'SKILL.md'))
  return {
    name: frontmatter.name ?? name,
    kind: 'skill',
    scope,
    origin: originFor(scope),
    path,
    description: frontmatter.description,
    enabled: true,
  }
}

/** Reads an extension directory's package.json description, if present. */
async function readExtension(
  path: string,
  name: string,
  scope: 'user' | 'project',
): Promise<CapabilityEntry> {
  return {
    name,
    kind: 'extension',
    scope,
    origin: originFor(scope),
    path,
    description: await readPackageDescription(join(path, 'package.json')),
    enabled: true,
  }
}

function originFor(scope: 'user' | 'project'): string {
  return scope === 'user' ? 'Pi agent' : 'Project (.pi)'
}

/** Parses `name:`/`description:` from a leading `---` frontmatter block without a YAML dependency. */
async function readFrontmatter(path: string): Promise<{ name?: string; description?: string }> {
  const content = await readBounded(path)
  if (!content || !content.startsWith('---\n')) return {}
  const end = content.indexOf('\n---', 4)
  if (end === -1) return {}
  const block = content.slice(4, end)
  const result: { name?: string; description?: string } = {}
  for (const line of block.split('\n')) {
    const nameMatch = /^name:\s*(.+)$/.exec(line)
    if (nameMatch) result.name = nameMatch[1].trim()
    const descriptionMatch = /^description:\s*(.+)$/.exec(line)
    if (descriptionMatch) result.description = descriptionMatch[1].trim()
  }
  return result
}

async function readPackageDescription(path: string): Promise<string | undefined> {
  const content = await readBounded(path)
  if (!content) return undefined
  try {
    const value: unknown = JSON.parse(content)
    return isObject(value) && typeof value.description === 'string' ? value.description : undefined
  } catch {
    return undefined
  }
}

/** Reads a file's leading bytes, tolerating a missing or unreadable file. */
async function readBounded(path: string): Promise<string | null> {
  try {
    const content = await readFile(path, 'utf8')
    return content.slice(0, MAX_FILE_BYTES)
  } catch {
    return null
  }
}

function isNotFound(error: unknown): boolean {
  return isObject(error) && error.code === 'ENOENT'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
