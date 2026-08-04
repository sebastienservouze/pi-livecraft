import { spawn, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'

export type DesktopPlatform = 'linux' | 'macos' | 'wsl' | 'windows'
type SpawnProcess = (
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2],
) => ChildProcess
type StatPath = (path: string) => Promise<{ isDirectory(): boolean }>

/** Identifies the supported desktop environment from the process platform and WSL markers. */
export function getDesktopPlatform(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): DesktopPlatform {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  if (platform !== 'linux') throw new Error(`Unsupported platform: ${platform}`)
  return env.WSL_DISTRO_NAME || env.WSL_INTEROP ? 'wsl' : 'linux'
}

/** Returns the WSL distribution running the backend when its name is available. */
export function getWslDistributionName(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.WSL_DISTRO_NAME || undefined
}

/** Opens a file or directory with its default application in the current desktop environment. */
export async function openPath(
  path: string,
  platform = getDesktopPlatform(),
  spawnProcess: SpawnProcess = spawn,
  statPath: StatPath = stat,
): Promise<void> {
  if (platform === 'windows') {
    const pathInfo = await statPath(path)
    if (pathInfo.isDirectory()) await openApplication('explorer.exe', path, spawnProcess)
    else await invokeWindowsPath(path, spawnProcess)
    return
  }
  const command = platform === 'wsl'
    ? 'explorer.exe'
    : platform === 'macos'
    ? 'open'
    : 'xdg-open'
  await openApplication(command, await externalWorkspacePath(path, platform), spawnProcess)
}

/** Opens the host folder chooser and returns the selected directory, or null when cancelled. */
export function chooseDirectory(
  initialPath: string,
  platform = getDesktopPlatform(),
  spawnProcess: SpawnProcess = spawn,
): Promise<string | null> {
  if (platform === 'macos') {
    const escapedPath = escapeAppleScriptString(initialPath)
    const script = [
      'try',
      `POSIX path of (choose folder with prompt "Choose a project folder" default location POSIX file "${escapedPath}")`,
      'on error number -128',
      'return ""',
      'end try',
    ]
      .join('\n')
    return runPickerProcess('osascript', ['-e', script], spawnProcess)
  }

  if (platform === 'windows') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$dialog.Description = "Choose a project folder"',
      '$dialog.SelectedPath = $env:PI_LIVECRAFT_PICKER_PATH',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  [Console]::Out.WriteLine($dialog.SelectedPath)',
      '}',
    ]
      .join('; ')
    return runPickerProcess(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      spawnProcess,
      { env: { ...process.env, PI_LIVECRAFT_PICKER_PATH: initialPath }, windowsHide: true },
    )
  }

  return runPickerProcess(
    'zenity',
    [
      '--file-selection',
      '--directory',
      '--title=Choose a project folder',
      `--filename=${initialPath}/`,
    ],
    spawnProcess,
  )
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

function runPickerProcess(
  command: string,
  args: string[],
  spawnProcess: SpawnProcess,
  extraOptions: Parameters<typeof spawn>[2] = {},
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      ...extraOptions,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let errorOutput = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString('utf8')
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      const selectedPath = output.trim()
      if (selectedPath) resolve(selectedPath)
      else if (code === 0 || code === 1) resolve(null)
      else reject(new Error(errorOutput.trim() || `${command} exited with code ${code}`))
    })
  })
}

function escapeAppleScriptString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ').replaceAll(
    '\r',
    ' ',
  )
}

/** Detaches a desktop application so restarting the backend never closes it. */
function openApplication(command: string, path: string, spawnProcess: SpawnProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, [path], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: false,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
