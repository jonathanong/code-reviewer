import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BenchDeps } from './cli.mts'
import {
  parseRepliesCases,
  renderReplies,
  runRepliesBenchCli,
  scoreReplies,
} from './replies-cli.mts'

const casesFile = fileURLToPath(new URL('../../../benchmarks/review/replies.json', import.meta.url))
const cases = parseRepliesCases(JSON.parse(readFileSync(casesFile, 'utf8')) as unknown)

const answer = (judgments: unknown) =>
  JSON.stringify({
    type: 'result',
    total_cost_usd: 0.01,
    num_turns: 1,
    structured_output: { judgments },
  })

function deps(exec: BenchDeps['exec']) {
  const files = new Map<string, string>()
  const bench = {
    exec,
    readFile: (path: string) => (path === 'cases.json' ? readFileSync(casesFile, 'utf8') : ''),
    writeFile: (path: string, text: string) => void files.set(path, text),
    exists: () => false,
    log: vi.fn(),
    prepare: vi.fn(),
  } as unknown as BenchDeps
  return { bench, files }
}

afterEach(() => vi.restoreAllMocks())

describe('the replies cases', () => {
  it('cover a valid acknowledgement and an unsupported pushback, each with a unique id', () => {
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length)
    const by = (id: string) => cases.find((item) => item.id === id)
    expect(by('replies-ack-breaking')).toMatchObject({
      expected: 'downgraded',
      expectedSeverity: 'medium',
    })
    expect(by('replies-pushback-without-evidence')?.expected).toBe('open')
    expect(by('replies-declared-answer-asked')?.expected).toBe('settled')
  })

  it('refuses a malformed file', () => {
    expect(() => parseRepliesCases([])).toThrow('must be a list')
    expect(() => parseRepliesCases([{ id: '' }])).toThrow('unique id')
    expect(() => parseRepliesCases([{ id: 'a' }])).toThrow('candidate is required')
    expect(() => parseRepliesCases([{ id: 'a', candidate: {}, expected: 'x' }])).toThrow('expected')
    expect(() => parseRepliesCases([{ id: 'a', candidate: {}, expected: 'downgraded' }])).toThrow(
      'expectedSeverity',
    )
    expect(() =>
      parseRepliesCases([
        { id: 'a', candidate: {}, expected: 'open' },
        { id: 'a', candidate: {}, expected: 'open' },
      ]),
    ).toThrow('unique id')
  })
})

describe('scoreReplies', () => {
  const [ack, , settled] = cases as [(typeof cases)[number], unknown, (typeof cases)[number]]
  const judgment = (
    outcome: 'settled' | 'downgraded' | 'open',
    severity = 'blocking' as const,
  ) => ({
    thread: ack.id,
    outcome,
    severity,
    why: 'w',
  })

  it('passes only the expected outcome, and a lowered finding only at the expected severity', () => {
    expect(scoreReplies(ack, judgment('downgraded', 'medium' as never), 0.1).pass).toBe(true)
    expect(scoreReplies(ack, judgment('downgraded', 'low' as never), 0.1).pass).toBe(false)
    expect(scoreReplies(ack, judgment('settled'), 0.1).pass).toBe(false)
    expect(scoreReplies(settled, judgment('settled'), null).pass).toBe(true)
    const failed = scoreReplies(ack, undefined, null)
    expect(failed).toMatchObject({ got: 'error', pass: false })
  })

  it('renders a table with the pass count', () => {
    const text = renderReplies([
      scoreReplies(ack, judgment('downgraded', 'medium' as never), 0.0123),
      scoreReplies(settled, undefined, null),
    ])
    expect(text).toContain('Passed 1 of 2.')
    expect(text).toContain('downgraded (medium) | pass | $0.0123')
    expect(text).toContain('FAIL | n/a')
  })
})

describe('runRepliesBenchCli', () => {
  it('runs each case, grades it, and writes the summary', async () => {
    const exec = vi.fn(async (_command: string, args: readonly string[]) => {
      const prompt = args.join(' ')
      const thread = cases.find((item) => prompt.includes(`"thread": "${item.id}"`))?.id ?? ''
      const expected = cases.find((item) => item.id === thread)
      return answer([
        {
          thread,
          outcome: expected?.expected ?? 'open',
          ...(expected?.expectedSeverity === undefined
            ? {}
            : { severity: expected.expectedSeverity }),
          why: 'As expected.',
        },
      ])
    })
    const { bench, files } = deps(exec as never)
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const code = await runRepliesBenchCli(['--cases', 'cases.json', '--out', 'o'], bench)
    expect(code).toBe(0)
    const printed = JSON.parse(String(out.mock.calls[0]?.[0])) as {
      attempts: number
      passed: number
    }
    expect(printed).toMatchObject({ attempts: cases.length, passed: cases.length })
    expect(files.get('o/summary.md')).toContain(`Passed ${cases.length} of ${cases.length}.`)
  })

  it('numbers repeated attempts, selects cases, and counts a failed call as a failure', async () => {
    const exec = vi.fn(async () => {
      throw new Error('no model')
    })
    const { bench, files } = deps(exec as never)
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runRepliesBenchCli(
      [
        '--cases',
        'cases.json',
        '--out',
        'o',
        '--case',
        'replies-injection',
        '--attempts',
        '2',
        '--model',
        'haiku',
      ],
      bench,
    )
    const { scores } = JSON.parse(files.get('o/summary.json') ?? '{}') as {
      scores: Array<{ id: string; pass: boolean }>
    }
    expect(scores.map((score) => [score.id, score.pass])).toEqual([
      ['replies-injection#1', false],
      ['replies-injection#2', false],
    ])
  })

  it('needs its flags, a case, a positive attempt count, and the rule', async () => {
    const { bench } = deps(vi.fn() as never)
    await expect(runRepliesBenchCli(['--out', 'o'], bench)).rejects.toThrow('needs --cases')
    await expect(
      runRepliesBenchCli(['--cases', 'cases.json', '--out', 'o', '--case', 'nope'], bench),
    ).rejects.toThrow('no cases')
    await expect(
      runRepliesBenchCli(['--cases', 'cases.json', '--out', 'o', '--attempts', '0'], bench),
    ).rejects.toThrow('positive integer')
    await expect(
      runRepliesBenchCli(
        [
          '--cases',
          'cases.json',
          '--out',
          'o',
          '--prompts',
          fileURLToPath(new URL('../run/fixtures/references', import.meta.url)),
        ],
        bench,
      ),
    ).rejects.toThrow('breaking-change rule')
  })
})
