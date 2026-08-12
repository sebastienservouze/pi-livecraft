import { spawn, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'

export type DesktopPlatform = 'linux' | 'macos' | 'wsl' | 'windows'
type SpawnProcess = (
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2],
) => ChildProcess
type StatPath = (path: string) => Promise<{ isDirectory(): boolean }>

const spawnStartTimeoutMs = 5_000

export class DesktopIntegrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DesktopIntegrationError'
  }
}

/** Identifies the supported desktop environment from the process platform and WSL markers. */
export function getDesktopPlatform(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): DesktopPlatform {
  if (platform === 'darwin') return 'macos'
  if (platform === 'win32') return 'windows'
  if (platform !== 'linux') throw new Error(`Unsupported platform: ${platform}`)
  return env.WSL_DISTRO_NAME || env.WSL_INTEROP ? 'wsl' : 'linux'
}

/**
 * Linux openers need a graphical session. Services without DISPLAY hang in
 * xdg-open/D-Bus instead of failing quickly on Raspberry Pi OS and other hosts.
 */
export function requireLinuxGraphicalSession(env: NodeJS.ProcessEnv = process.env): void {
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return
  throw new DesktopIntegrationError(
    'No graphical display on this host (DISPLAY/WAYLAND_DISPLAY unset). Opening a file starts an application on the backend desktop; use the Files panel to read it in the browser instead.',
  )
}

/** Opens a file or directory with its default application in the current desktop environment. */
export async function openPath(
  path: string,
  platform = getDesktopPlatform(),
  spawnProcess: SpawnProcess = spawn,
  statPath: StatPath = stat,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (platform === 'windows') {
    const pathInfo = await statPath(path)
    if (pathInfo.isDirectory()) await openApplication('explorer.exe', [path], spawnProcess)
    else await invokeWindowsPath(path, spawnProcess)
    return
  }
  if (platform === 'wsl') {
    await openApplication(
      'explorer.exe',
      [await externalWorkspacePath(path, platform)],
      spawnProcess,
    )
    return
  }
  if (platform === 'macos') {
    await openApplication('open', [await externalWorkspacePath(path, platform)], spawnProcess)
    return
  }

  requireLinuxGraphicalSession(env)
  const target = await externalWorkspacePath(path, platform)
  const candidates = linuxOpenInvocations(target)
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      await openApplication(candidate.command, candidate.args, spawnProcess)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new DesktopIntegrationError('No file manager application is available')
}

/** Linux openers tried in order; Raspberry Pi OS commonly ships pcmanfm. */
export function linuxOpenInvocations(path: string): Array<{ command: string; args: string[] }> {
  return [
    { command: 'xdg-open', args: [path] },
    { command: 'gio', args: ['open', path] },
    { command: 'pcmanfm', args: [path] },
    { command: 'thunar', args: [path] },
    { command: 'nautilus', args: ['--no-desktop', path] },
  ]
}

/** Returns the path format expected by the browser or desktop integration. */
export function externalWorkspacePath(
  workspacePath: string,
  platform = getDesktopPlatform(),
  convertPath = convertWslPath,
): Promise<string> {
  return platform === 'wsl' ? convertPath(workspacePath) : Promise.resolve(workspacePath)
}

/** Converts a WSL path to the Windows format understood by Windows applications. */
function convertWslPath(workspacePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn('wslpath', ['-w', workspacePath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let errorOutput = ''
    process.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    process.stderr.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString('utf8')
    })
    process.once('error', reject)
    process.once('exit', (code) => {
      const windowsPath = output.trim()
      if (code === 0 && windowsPath) resolve(windowsPath)
      else reject(new Error(errorOutput.trim() || `wslpath exited with code ${code}`))
    })
  })
}

/** Uses a constant script; the untrusted path is passed only as an environment value. */
function invokeWindowsPath(path: string, spawnProcess: SpawnProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$ErrorActionPreference = "Stop"; Start-Process -FilePath $env:PI_LIVECRAFT_OPEN_PATH -WindowStyle Normal',
      ],
      {
        env: { ...process.env, PI_LIVECRAFT_OPEN_PATH: path },
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      },
    )
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Windows path opener exited with code ${code ?? 'unknown'}`))
    })
  })
}

/** Detaches a desktop application so restarting the backend never closes it. */
export function openApplication(
  command: string,
  args: string[],
  spawnProcess: SpawnProcess = spawn,
  timeoutMs = spawnStartTimeoutMs,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: false,
    })
    const timer = setTimeout(() => {
      reject(
        new DesktopIntegrationError(
          `${command} did not start within ${timeoutMs}ms (is a desktop session available?)`,
        ),
      )
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('spawn', () => {
      clearTimeout(timer)
      child.unref()
      resolve()
    })
  })
}
