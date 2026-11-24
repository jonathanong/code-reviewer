import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import type { FocusPoint } from '../focus.mts'
import { buildFocusPrompt } from './focus-prompt.mts'
import { runFocus } from './focus-run.mts'
import { runPillarsAndFocus } from './review-focus.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const BASE = 'b'.repeat(40)
const HEAD = 'c'.repeat(40)
const OTHER = 'd'.repeat(40)
const ANSWER = JSON.stringify({
  type: 'result',
  total_cost_usd: 0.5,
  num_turns: 2,
  structured_output: {
    points: [{ index: 0, status: 'holds', basis: 'Yes.', path: 'a.ts', line: 2 }],
    findings: [],
  },
})

/** Answers git by subcommand; a diff that ends at the other head is the named pull request's. */
function fakeExec(options: { fetchFails?: boolean; gitFails?: boolean } = {}) {
  return vi.fn<Exec>(async (command, args) => {
    if (command !== 'git') return ANSWER
    if (options.gitFails === true) throw new Error('no git')
    if (args[0] === 'fetch') {
      if (options.fetchFails === true) throw new Error('no such ref')
      return ''
    }
    if (args[0] === 'rev-parse') return `${OTHER}\n`
    if (args[0] === 'merge-base') return `${BASE}\n`
    if (args.includes('--name-status')) {
      return args.at(-1) === OTHER ? 'A\0docs/a.md\0A\0docs/only-there.md\0' : 'M\0docs/a.md\0'
    }
    return ''
  })
}

function setup(points: FocusPoint[], exec: Exec, extra: { pr?: number } = {}) {
  const out = mkdtempSync(join(tmpdir(), 'focus-named-'))
  dirs.push(out)
  const run = { out, sinceSha: null, hasRules: false }
  const input = {
    points,
    tree: '/tree',
    run,
    baseSha: BASE,
    headSha: HEAD,
    mode: 'full' as const,
    contract: 'CONTRACT',
    exec,
    ...extra,
  }
  return { input, run }
}

/** The prompt the model step was given: the one argument that starts with the contract. */
const sentPrompt = (exec: ReturnType<typeof fakeExec>) => {
  const call = exec.mock.calls.find(([command]) => command !== 'git')
  return (call as [string, string[]])[1].find((arg) => arg.startsWith('CONTRACT')) as string
}

describe('runFocus with a point that names another pull request', () => {
  it('adds one computed block per named pull request to the prompt', async () => {
    const exec = fakeExec()
    const points: FocusPoint[] = [
      { point: 'Does not duplicate pull request #7.', origin: 'requester' },
    ]
    const { input } = setup(points, exec, { pr: 3 })
    const { answers } = await runFocus(input)
    const prompt = sentPrompt(exec)
    expect(prompt).toContain('## Pull request #7, named in a point')
    expect(prompt).toContain('head `dddddddddddd`, 2 changed files')
    expect(prompt).toContain('| `docs/a.md` | added | yes |')
    expect(prompt).toContain('| `docs/only-there.md` | added | no |')
    expect(answers[0]?.status).toBe('holds')
  })

  it('keeps the review going when the pull request cannot be read', async () => {
    const exec = fakeExec({ fetchFails: true })
    const points: FocusPoint[] = [{ point: 'Same as PR 7?', origin: 'requester' }]
    const { answers } = await runFocus(setup(points, exec).input)
    const prompt = sentPrompt(exec)
    expect(prompt).toContain('Pull request #7 could not be read from git')
    expect(answers[0]?.status).toBe('holds')
  })

  it('passes a pinned commit through to the fact', async () => {
    const exec = fakeExec()
    const points: FocusPoint[] = [{ point: 'Same as PR 7?', origin: 'requester' }]
    const { input } = setup(points, exec)
    await runFocus({ ...input, refs: { '7': 'e'.repeat(40) } })
    const git = exec.mock.calls.filter(([c]) => c === 'git').map(([, args]) => args)
    expect(git).toContainEqual(['cat-file', '-e', `${'e'.repeat(40)}^{commit}`])
    expect(git.some((args) => args[0] === 'fetch')).toBe(false)
  })
})

describe('runFocus with no point that names another pull request', () => {
  it.each([
    ['plain point', [{ point: 'the loop is bounded', origin: 'requester' as const }], undefined],
    ['the reviewed pull request', [{ point: 'See #3.', origin: 'requester' as const }], 3],
    ['a target point', [{ point: 'See #7.', origin: 'target:guard' as const }], undefined],
  ])('leaves the prompt as it was and fetches nothing: %s', async (_name, points, pr) => {
    const exec = fakeExec({ gitFails: true })
    const { input, run } = setup(points, exec, pr === undefined ? {} : { pr })
    await runFocus(input)
    const expected = buildFocusPrompt(
      { contract: 'CONTRACT', run, contextFile: undefined, skills: [] },
      points,
      undefined,
    )
    expect(sentPrompt(exec)).toBe(expected)
    expect(exec.mock.calls.some(([, args]) => args[0] === 'fetch')).toBe(false)
  })
})

describe('runPillarsAndFocus', () => {
  it('tells the focus step which pull request is under review', async () => {
    const exec = fakeExec()
    const { input, run } = setup([], exec)
    await runPillarsAndFocus(
      { ...input, pillars: [], readPillar: () => '', skills: [], jobs: 1, run },
      ['Same as #3 and #7?'],
      { baseSha: BASE, headSha: HEAD, pr: 3 },
    )
    const prompt = sentPrompt(exec)
    expect(prompt).toContain('## Pull request #7, named in a point')
    expect(prompt).not.toContain('## Pull request #3')
  })
})
