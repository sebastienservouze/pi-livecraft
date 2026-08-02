import { isObject } from '../../../shared/is-object.ts'
import type { JsonObject } from '../../../shared/types.ts'

const ESC = String.fromCodePoint(0x1B)
const C1_CSI = String.fromCodePoint(0x9B)
const SGR_SEQUENCE = new RegExp(`(?:${ESC}\\[|${C1_CSI})[0-?]*[ -/]*m`, 'g')

/** Removes terminal SGR styling only from assistant reasoning rendered by the browser. */
export function reasoningTextForDisplay(role: unknown, text: string): string {
  return role === 'assistant' ? text.replace(SGR_SEQUENCE, '') : text
}

/** Accepts only protocol messages whose role and content have a visible thread representation. */
export function isVisibleConversationMessage(message: JsonObject): boolean {
  const role = message.role
  if (role === 'custom') return message.display === true && typeof message.customType === 'string'
  return (role === 'user' || role === 'assistant' || role === 'system')
    && hasVisibleContent(message.content ?? message.output)
}

/** Reports whether protocol content contains text, thinking, or a supported inline image. */
export function hasVisibleContent(content: unknown): boolean {
  if (typeof content === 'string') return content.trim().length > 0
  return Array.isArray(content) && content.some((part) =>
    isObject(part) && (
      (part.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0)
      || (part.type === 'thinking' && typeof part.thinking === 'string'
        && part.thinking.trim().length > 0)
      || isImageContent(part)
    )
  )
}

function isImageContent(value: unknown): boolean {
  return isObject(value) && value.type === 'image' && typeof value.data === 'string'
    && typeof value.mimeType === 'string'
    && /^image\/(?:gif|jpeg|png|webp)$/.test(value.mimeType)
}
