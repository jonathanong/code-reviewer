export const ASK_OF = ['author', 'product'] as const
export type AskOf = (typeof ASK_OF)[number]

/** Something the code and context cannot settle, whose answer could change the review. */
export type Question = {
  question: string
  askOf: AskOf
  /** What the answer changes about the review. */
  why: string
}

export const QUESTIONS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['question', 'askOf', 'why'],
    additionalProperties: false,
    properties: {
      question: { type: 'string' },
      askOf: { type: 'string', enum: [...ASK_OF] },
      why: { type: 'string' },
    },
  },
} as const

const HEADING = '### Questions'
const WHO: Record<AskOf, string> = { author: 'Author', product: 'Product' }
const QUESTION_RE = /^- \*\*(Author|Product):\*\* (.+)\n {2}Why it matters: (.+)$/gmu

function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/** Renders the review body's Questions section; empty when there are none. */
export function renderQuestions(questions: readonly Question[]): string[] {
  if (questions.length === 0) return []
  const rows = questions.map(
    (item) =>
      `- **${WHO[item.askOf]}:** ${oneLine(item.question)}\n  Why it matters: ${oneLine(item.why)}`,
  )
  return [`${HEADING}\n\n${rows.join('\n')}`]
}

/** Reads the questions a posted review body carries, so a follow-up does not ask them again. */
export function parseQuestions(body: string): Question[] {
  return [...body.matchAll(QUESTION_RE)].map((match) => ({
    askOf: match[1] === 'Product' ? 'product' : 'author',
    question: match[2] as string,
    why: match[3] as string,
  }))
}
