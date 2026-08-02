import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { calculateManagerRuntimeRevision } from './manager-runtime.ts'
import { forceKillWindowsProcessTree } from './pi-process.ts'

const managerEntry = fileURLToPath(new URL('./manager.ts', import.meta.url))
const restartExitCode = 75
let child: ChildProcess | undefined
let failureHold: NodeJS.Timeout | undefined
let stopping = false

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
void launch()

/** Starts one manager with the revision captured immediately before process creation. */
async function launch(): Promise<void> {
  try {
    const { revision } = await calculateManagerRuntimeRevision()
    if (stopping) return
    child = spawn(process.execPath, [managerEntry], {
      env: {
        ...process.env,
        PI_LIVECRAFT_MANAGER_RESTART_EXIT_CODE: String(restartExitCode),
        PI_LIVECRAFT_MANAGER_RUNTIME_REVISION: revision,
        PI_LIVECRAFT_MANAGER_SUPERVISED: '1',
      },
      stdio: 'inherit',
    })
    child.once('error', (error) => {
      console.error(`Pi manager failed to start: ${error.message}`)
    })
    child.once('close', (code, signal) => {
      child = undefined
      if (stopping) process.exit(0)
      if (code === restartExitCode) void launch()
      else {
        console.error(
          `Pi manager stopped unexpectedly (${
            signal ?? code ?? 'unknown'
          }); restart Pi Livecraft to recover.`,
        )
        failureHold = setInterval(() => undefined, 60_000)
      }
    })
  } catch (error) {
    console.error(`Pi manager runtime could not be read: ${errorMessage(error)}`)
    process.exit(1)
  }
}

/** Forwards application shutdown to the manager and bounds an unresponsive child. */
function stop(signal: NodeJS.Signals): void {
  if (stopping) return
  stopping = true
  if (failureHold) clearInterval(failureHold)
  if (!child) {
    process.exit(0)
    return
  }
  if (process.platform === 'win32') {
    const manager = child
    setTimeout(() => void forceKillWindowsProcessTree(manager), 3_000).unref()
    return
  }
  child.kill(signal)
  setTimeout(() => child?.kill('SIGKILL'), 3_000).unref()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
