import {
  defaultWorkerName,
  isGenericSessionName,
  unnamedSessionName,
} from '../../../shared/session-names.ts'

const maxSessionTitleLength = 90
const separator = ' — '

/** Builds an immediate fallback context while leaving later extension-generated titles free to replace it. */
export function promptSessionTitle(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  return normalized.length > maxSessionTitleLength
    ? `${normalized.slice(0, maxSessionTitleLength - 1)}…`
    : normalized
}

/** Joins a worker label and a short context into the canonical `<worker> — <context>` thread title. */
export function composeThreadTitle(worker: string, context: string): string {
  const workerName = worker.trim() || defaultWorkerName
  const trimmedContext = context.trim()
  return trimmedContext ? `${workerName}${separator}${trimmedContext}` : workerName
}

/**
 * Formats the title shown for a thread. Stored session names are always plain context (the first
 * prompt or a Pi-generated title), so the current worker is composed in at render time — which
 * preserves the worker prefix across later Pi renames and guarantees a non-blank, non-generic
 * result. The exact current-worker self-prefix is stripped first so re-composition is idempotent.
 */
export function displayThreadTitle(rawName: string | undefined, worker?: string): string {
  const workerName = (worker ?? '').trim() || defaultWorkerName
  let context = (rawName ?? '').trim()
  if (isGenericSessionName(context)) context = ''
  const selfPrefix = `${workerName}${separator}`
  if (context.startsWith(selfPrefix)) context = context.slice(selfPrefix.length).trim()
  return composeThreadTitle(workerName, context)
}

/**
 * Thread title as plain context: worker prefixes (current worker or the generic default) are
 * stripped and never re-composed — worker identity lives in the row's meta line instead.
 */
export function threadContextTitle(rawName: string | undefined, worker?: string): string {
  const workerName = (worker ?? '').trim() || defaultWorkerName
  let context = (rawName ?? '').trim()
  for (const prefix of [`${workerName}${separator}`, `${defaultWorkerName}${separator}`]) {
    if (context.startsWith(prefix)) context = context.slice(prefix.length).trim()
  }
  if (isGenericSessionName(context)) context = ''
  return context || unnamedSessionName
}
