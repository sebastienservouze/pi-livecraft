import { spawn } from 'node:child_process'
import test from 'node:test'
import { forceKillChild } from '../server/pi-process.ts'

test(
  'Windows tree escalation terminates a child and its descendant',
  { skip: process.platform !== 'win32', timeout: 10_000 },
  async (t) => {
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import { spawn } from 'node:child_process'
const grandchild = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1_000)'], {
  stdio: 'ignore',
  windowsHide: true,
})
process.stdout.write(String(grandchild.pid) + '\\n')
setInterval(() => {}, 1_000)`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    )
    let grandchildPid: number | undefined
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) await forceKillChild(child)
      if (grandchildPid && isRunning(grandchildPid)) {
        try {
          process.kill(grandchildPid, 'SIGKILL')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
        }
        await waitForExit(grandchildPid)
      }
    })

    grandchildPid = await readPid(child)
    const childPid = child.pid
    if (!childPid) throw new Error('Child did not report a PID')
    await forceKillChild(child)
    await waitForExit(childPid)
    await waitForExit(grandchildPid)
  },
)

function readPid(child: ReturnType<typeof spawn>): Promise<number> {
  const stdout = child.stdout
  if (!stdout) return Promise.reject(new Error('Child stdout is unavailable'))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for grandchild PID')),
      3_000,
    )
    stdout.once('data', (chunk: Buffer) => {
      clearTimeout(timeout)
      const pid = Number(chunk.toString('utf8').trim())
      if (!Number.isInteger(pid) || pid < 1)
        reject(new Error('Child returned an invalid grandchild PID'))
      else resolve(pid)
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + 3_000
  while (isRunning(pid)) {
    if (Date.now() >= deadline) throw new Error(`Process ${pid} did not exit`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}
