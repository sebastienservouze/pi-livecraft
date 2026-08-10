import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import type {
  AskUserQuestion,
  AskUserQuestionAnswer,
  AskUserQuestionRequest,
  AskUserQuestionResponse,
} from '../shared/ask-user-question.ts'
import {
  askUserQuestionProtocol,
  askUserQuestionVersion,
  parseAskUserQuestionRequest,
  parseAskUserQuestionResponse,
} from '../shared/ask-user-question.ts'
const rpcTitle = 'Pi Coding UI questionnaire'
export default function registerAskUserQuestion(pi: ExtensionAPI): void {
  // Register after extension loading so a same-named auto-discovered tool does not trigger Pi's fatal load diagnostic.
  pi.on('session_start', () => registerAskUserQuestionTool(pi))
}

function registerAskUserQuestionTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'ask_user_question',
    label: 'Ask User Question',
    description:
      'Ask the user one or more structured questions when a decision is needed to proceed.',
    promptSnippet: 'Ask the user up to 4 structured questions when requirements need a decision.',
    promptGuidelines: [
      'Use ask_user_question for decisions that need user input; group related questions in one call.',
      'Use 2 to 4 concise options per question. Put a recommended option first and append "(Recommended)" to its label.',
      'Set multiSelect when more than one option may be chosen. Do not create "Other" or "Chat about this" options.',
    ],
    parameters: Type.Object({
      questions: Type.Array(Type.Object({
        question: Type.String(),
        header: Type.String(),
        multiSelect: Type.Optional(Type.Boolean()),
        options: Type.Array(Type.Object({
          label: Type.String(),
          description: Type.String(),
        })),
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const request = parseAskUserQuestionRequest({
        protocol: askUserQuestionProtocol,
        version: askUserQuestionVersion,
        questions: Array.isArray(params.questions)
          ? params.questions.map((question) => ({
            ...question,
            multiSelect: question.multiSelect ?? false,
          }))
          : [],
      })
      if (!request)
        return result({ answers: [], cancelled: true }, 'The questionnaire was invalid.')

      const response = ctx.mode === 'tui'
        ? await askInTui(request, ctx)
        : await askInPluginUi(request, ctx)
      return result(
        response,
        response.cancelled
          ? 'The user cancelled the questionnaire.'
          : formatAnswers(response.answers),
      )
    },
  })
}

async function askInPluginUi(request: AskUserQuestionRequest, ctx: ExtensionContext) {
  const value = await ctx.ui.editor(rpcTitle, JSON.stringify(request))
  if (!value) return { answers: [], cancelled: true }
  try {
    return parseAskUserQuestionResponse(JSON.parse(value), request)
      ?? { answers: [], cancelled: true }
  } catch {
    return { answers: [], cancelled: true }
  }
}

async function askInTui(request: AskUserQuestionRequest, ctx: ExtensionContext) {
  const answers: AskUserQuestionAnswer[] = []
  for (const question of request.questions) {
    const answer = question.multiSelect
      ? await selectMany(question, ctx)
      : await selectOne(question, ctx)
    if (!answer) return { answers: [], cancelled: true }
    answers.push(answer)
  }
  return { answers, cancelled: false }
}

async function selectOne(
  question: AskUserQuestion,
  ctx: ExtensionContext,
): Promise<AskUserQuestionAnswer | null> {
  const custom = 'Type something…'
  const chat = 'Chat about this'
  const options = [...question.options.map(formatOption), custom, chat]
  const selection = await ctx.ui.select(`${question.header}\n${question.question}`, options)
  if (!selection) return null
  if (selection === custom || selection === chat) {
    const text = await ctx.ui.input(
      question.question,
      selection === chat ? 'Your message' : 'Your answer',
    )
    return text?.trim() ? { question: question.question, selectedOptions: [], text } : null
  }
  const option = question.options.find((candidate) => formatOption(candidate) === selection)
  return option ? { question: question.question, selectedOptions: [option.label] } : null
}

async function selectMany(
  question: AskUserQuestion,
  ctx: ExtensionContext,
): Promise<AskUserQuestionAnswer | null> {
  const done = 'Submit selection'
  const selected = new Set<string>()
  while (true) {
    const options = question.options.map((option) =>
      `${selected.has(option.label) ? '✓ ' : ''}${formatOption(option)}`
    )
    const choice = await ctx.ui.select(`${question.header}\n${question.question}`, [
      ...options,
      done,
    ])
    if (!choice) return null
    if (choice === done)
      return selected.size
        ? { question: question.question, selectedOptions: [...selected] }
        : null
    const option = question.options.find((candidate) => choice.endsWith(formatOption(candidate)))
    if (!option) return null
    if (selected.has(option.label)) selected.delete(option.label)
    else selected.add(option.label)
  }
}

function formatOption(option: AskUserQuestion['options'][number]): string {
  return `${option.label} — ${option.description}`
}

function formatAnswers(answers: AskUserQuestionAnswer[]): string {
  return answers
    .map((answer) =>
      `${answer.question}: ${[...answer.selectedOptions, answer.text].filter(Boolean).join(', ')}`
    )
    .join('\n')
}

function result(details: { answers: AskUserQuestionAnswer[]; cancelled: boolean }, text: string) {
  return { content: [{ type: 'text' as const, text }], details }
}
