export interface TerminalSpan {
  text: string
  className: string
}

interface Cell {
  char: string
  className: string
}

/** Keeps memory bounded while leaving enough scrollback for a build or test run. */
const maxLines = 2000
const tabWidth = 8

const foregroundClasses = new Map<number, string>([
  [30, 'ansi-black'],
  [31, 'ansi-red'],
  [32, 'ansi-green'],
  [33, 'ansi-yellow'],
  [34, 'ansi-blue'],
  [35, 'ansi-magenta'],
  [36, 'ansi-cyan'],
  [37, 'ansi-white'],
])

/**
 * Renders raw shell output as styled lines.
 *
 * The shell runs in a pseudo terminal, so its output contains carriage returns and
 * escape sequences. Cells are tracked per column, which is what makes overwriting
 * output such as progress bars land on the line it is meant to replace. Only the
 * subset of sequences a command-line session actually emits is interpreted; anything
 * else is dropped instead of leaking into the text.
 */
export function terminalLines(output: string): TerminalSpan[][] {
  const lines: Cell[][] = [[]]
  let column = 0
  let foreground = ''
  let bold = false

  const currentClassName = (): string =>
    [foreground, bold ? 'ansi-bold' : ''].filter(Boolean).join(' ')

  const write = (char: string): void => {
    const line = lines[lines.length - 1]
    while (line.length < column) line.push({ char: ' ', className: '' })
    line[column] = { char, className: currentClassName() }
    column += 1
  }

  for (let index = 0; index < output.length; index += 1) {
    const char = output[index]

    if (char === '\u001b') {
      const sequence = readEscapeSequence(output, index)
      if (!sequence) break
      index = sequence.endIndex
      if (sequence.finalByte === 'm') {
        const codes = parseCodes(sequence.parameters)
        for (const code of codes) {
          if (code === 0) {
            foreground = ''
            bold = false
          } else if (code === 1) bold = true
          else if (code === 22) bold = false
          else if (code === 39) foreground = ''
          else if (foregroundClasses.has(code)) foreground = foregroundClasses.get(code) ?? ''
          else if (code >= 90 && code <= 97) {
            foreground = `${foregroundClasses.get(code - 60) ?? ''} ansi-bright`.trim()
          }
        }
      } else if (sequence.finalByte === 'K') {
        const line = lines[lines.length - 1]
        line.length = Math.min(line.length, column)
      } else if (sequence.finalByte === 'J') {
        lines.splice(0, lines.length, [])
        column = 0
      }
      continue
    }

    if (char === '\n') {
      lines.push([])
      column = 0
      if (lines.length > maxLines) lines.splice(0, lines.length - maxLines)
      continue
    }
    if (char === '\r') {
      column = 0
      continue
    }
    if (char === '\b') {
      column = Math.max(0, column - 1)
      continue
    }
    if (char === '\t') {
      const target = column + (tabWidth - (column % tabWidth))
      while (column < target) write(' ')
      continue
    }
    if (char === '\u0007' || char < ' ') continue
    write(char)
  }

  return lines.map(toSpans)
}

/** Groups neighbouring cells sharing one style so the panel renders few nodes. */
function toSpans(cells: Cell[]): TerminalSpan[] {
  const spans: TerminalSpan[] = []
  for (const cell of cells) {
    const last = spans[spans.length - 1]
    if (last && last.className === cell.className) last.text += cell.char
    else spans.push({ text: cell.char, className: cell.className })
  }
  return spans
}

function readEscapeSequence(
  output: string,
  start: number,
): { parameters: string; finalByte: string; endIndex: number } | null {
  if (output[start + 1] !== '[') {
    // Two-character sequences and OSC strings carry no styling this panel renders.
    if (output[start + 1] === ']') {
      const terminator = output.indexOf('\u0007', start)
      return terminator === -1
        ? null
        : { parameters: '', finalByte: '', endIndex: terminator }
    }
    return start + 1 < output.length
      ? { parameters: '', finalByte: '', endIndex: start + 1 }
      : null
  }
  for (let index = start + 2; index < output.length; index += 1) {
    const char = output[index]
    if (char >= '@' && char <= '~') {
      return {
        parameters: output.slice(start + 2, index),
        finalByte: char,
        endIndex: index,
      }
    }
  }
  return null
}

function parseCodes(parameters: string): number[] {
  const codes = parameters
    .split(';')
    .map((value) => (value === '' ? 0 : Number(value)))
    .filter((value) => Number.isInteger(value))
  return codes.length > 0 ? codes : [0]
}
