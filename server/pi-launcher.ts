import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { findPackageJSON } from 'node:module'
import { delimiter, dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const piPackage = '@earendil-works/pi-coding-agent'

export interface PiLauncherInvocation {
  command: string
  argsPrefix: string[]
}

interface PiPackageJson {
  bin?: { pi?: unknown }
}

/**
 * Resolves Pi without executing npm's Windows command shim. On Windows npm installs
 * pi.cmd, but invoking its package CLI with Node keeps every RPC argument out of cmd.exe.
 */
export function resolvePiLauncher(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  pathDelimiter = delimiter,
): PiLauncherInvocation {
  if (platform !== 'win32') return { command: 'pi', argsPrefix: [] }

  const path = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1]
  if (!path) throw new Error('Cannot find pi.cmd because PATH is empty')

  for (const directory of path.split(pathDelimiter)) {
    if (!directory) continue
    const piCmdPath = resolve(directory, 'pi.cmd')
    if (!existsSync(piCmdPath)) continue

    try {
      const packageJsonPath = findPackageJSON(piPackage, pathToFileURL(piCmdPath))
      if (!packageJsonPath) continue
      const packageRoot = realpathSync(dirname(packageJsonPath))
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PiPackageJson
      const bin = packageJson.bin?.pi
      if (typeof bin !== 'string' || !bin) continue

      const cliPath = realpathSync(resolve(packageRoot, bin))
      if (!isPathInside(packageRoot, cliPath)) continue
      return { command: process.execPath, argsPrefix: [cliPath] }
    } catch {
      continue
    }
  }

  throw new Error(`Cannot find ${piPackage} from a pi.cmd entry on PATH`)
}

function isPathInside(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path)
  return Boolean(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith('../')
    && !pathFromRoot.startsWith('..\\') && !isAbsolute(pathFromRoot)
}
