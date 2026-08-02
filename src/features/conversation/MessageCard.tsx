import { memo, type ReactNode } from 'react'
import type { JsonObject } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'
import { CopyButton } from './CopyButton.tsx'
import { Markdown } from './Markdown.tsx'
import { hasVisibleContent, reasoningTextForDisplay } from './message-display.ts'
import { formatTokens, formatTurnCost, type MessageUsage } from './message-usage.ts'

/** Renders a visible protocol message with the default or custom presentation. */
export const MessageCard = memo(
  function MessageCard(
    { message, onError }: {
      message: JsonObject
      onError: (cause: unknown) => void
    },
  ) {
    if (message.role === 'custom' && typeof message.customType === 'string')
      return <DefaultCustomMessage message={message} />
    return <DefaultMessageCard message={message} onError={onError} />
  },
)

const DefaultMessageCard = memo(
  function DefaultMessageCard(
    { message, onError }: {
      message: JsonObject
      onError: (cause: unknown) => void
    },
  ) {
    const role = String(message.role)
    const timestamp = typeof message.timestamp === 'number' ? new Date(message.timestamp) : null
    const time = timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : null
    const text = visibleText(message.content ?? message.output)
    return (
      <article className={`message ${role}`}>
        {text && (
          <div className='conversation-actions message-actions'>
            <CopyButton label='Copy message' onError={onError} value={text} />
          </div>
        )}
        <div className='content'>
          {renderContent(message.content ?? message.output, message.role)}
        </div>
        {role === 'user' && time && (
          <time
            className='message-time'
            dateTime={time.toISOString()}
          >
            {time.toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit' })}
          </time>
        )}
      </article>
    )
  },
)

/** Renders an unknown custom message without interpreting extension-specific details. */
function DefaultCustomMessage({ message }: { message: JsonObject & { customType?: unknown } }) {
  const content = hasVisibleContent(message.content)
    ? renderContent(message.content, message.role)
    : <p>Message has no displayable content.</p>
  return (
    <article className='message custom-message'>
      <code className='custom-message-type'>{String(message.customType)}</code>
      <div className='content'>{content}</div>
    </article>
  )
}

/** Displays counters billed by Pi for a completed assistant response. */
export function TurnUsage({ turnNumber, usage }: { turnNumber?: number; usage: MessageUsage }) {
  return (
    <dl className='turn-usage'>
      {turnNumber !== undefined && (
        <div>
          <dt>Turn</dt>
          <dd>{turnNumber}</dd>
        </div>
      )}
      <div>
        <dt>Cost</dt>
        <dd>{formatTurnCost(usage.cost)}</dd>
      </div>
      <div>
        <dt>Cache read</dt>
        <dd>{formatTokens(usage.cacheRead)}</dd>
      </div>
      <div>
        <dt>Cache miss</dt>
        <dd>{formatTokens(usage.cacheMiss)}</dd>
      </div>
      <div>
        <dt>Output</dt>
        <dd>{formatTokens(usage.output)}</dd>
      </div>
    </dl>
  )
}

function visibleText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part) =>
      isObject(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []
    )
    .join('')
}

/** Renders message content in protocol order, including visible thinking. */
function renderContent(content: unknown, role: unknown): ReactNode {
  if (typeof content === 'string') return <Markdown>{content}</Markdown>
  if (!Array.isArray(content)) return null
  return (
    <>
      {content.map((part, contentIndex) => {
        if (isImageContent(part))
          return (
            <img
              alt={`Attached image ${contentIndex + 1}`}
              className='message-image'
              key={`image-${contentIndex}`}
              src={`data:${part.mimeType};base64,${part.data}`}
            />
          )
        if (!isObject(part)) return null
        if (part.type === 'thinking' && typeof part.thinking === 'string' && part.thinking.trim())
          return (
            <ReasoningBlock key={`reasoning-${contentIndex}`}>
              {reasoningTextForDisplay(role, part.thinking)}
            </ReasoningBlock>
          )
        if (part.type === 'text' && typeof part.text === 'string')
          return <Markdown key={`text-${contentIndex}`}>{part.text}</Markdown>
        return null
      })}
    </>
  )
}

/** Presents thinking directly in the thread with a subtle hierarchy. */
function ReasoningBlock({ children, live = false }: { children: string; live?: boolean }) {
  return (
    <div className={`reasoning${live ? ' conversation-entry' : ''}`}>
      <Markdown>{children}</Markdown>
    </div>
  )
}

function isImageContent(value: unknown): value is JsonObject & { data: string; mimeType: string } {
  return isObject(value) && value.type === 'image' && typeof value.data === 'string' && typeof value
        .mimeType === 'string'
    && /^image\/(?:gif|jpeg|png|webp)$/.test(value.mimeType)
}
