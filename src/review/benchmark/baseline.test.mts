import { describe, expect, it } from 'vitest'

import { baselineNotes, compareBaseline, readBaseline } from './baseline.mts'
import { parseEvalCases } from './cases.mts'
import type { BenchDeps } from './cli.mts'
import { judgeInputs } from './judge-all.mts'
import { scoreAll, type Options } from './score-all.mts'

const base = {
  repo: 'acme/widgets',
  pr: 1,
  title: 't',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
}
const expected = [{ pillar: 'rules', severity: 'high', path: 'a.ts', lines: null, claim: 'c' }]
const positive = (id: string, expectedSkills?: string[]) => ({
  ...base,
  id,
  kind: 'positive',
  expected,
  ...(expectedSkills === undefined ? {} : { expectedSkills }),
})
const cases = parseEvalCases([
  positive('p1', ['r:x']),
  positive('p2', ['r:x']),
  positive('p3', ['r:x']),
  positive('plain'),
])
const finding = { pillar: 'rules', severity: 'high', title: 'T', body: 'B', path: 'a.ts', line: 1 }
const run = (findings: unknown[], skills: string[] = [], extra = {}) =>
  JSON.stringify({ findings, skills, skillTool: skills.length > 0, ...extra })

function deps(files: Record<string, string>): BenchDeps {
  const written = new Map<string, string>()
  return {
    exec: async () => '',
    readFile: (path) => written.get(path) ?? files[path] ?? '',
    writeFile: (path, text) => void written.set(path, text),
    exists: (path) => path in files,
    log: () => undefined,
    prepare: async () => ({ dir: '', diff: '', body: '' }),
  }
}

const options = (extra: Partial<Options> = {}): Options => ({
  out: 'out',
  prompts: '',
  model: 'm',
  maxTurns: 1,
  jobs: 1,
  scoreOnly: true,
  judge: undefined,
  noRules: false,
  select: false,
  baseline: 'ctl',
  ...extra,
})

describe('paired control', () => {
  const files = {
    'out/raw/rules/p1.json': run([finding], ['r:x']),
    'out/raw/rules/p2.json': run([finding], ['r:x']),
    'out/raw/rules/p3.json': run([], ['r:x']),
    'out/raw/rules/plain.json': run([finding]),
    'ctl/raw/rules/p1.json': run([finding]),
    'ctl/raw/rules/p2.json': run([]),
    'ctl/raw/rules/plain.json': run([finding]),
  }

  it('compares over positives with expectedSkills scored in both runs', () => {
    const control = readBaseline(cases, 'rules', 'ctl', undefined, deps(files))
    expect([...control]).toEqual([
      ['p1', true],
      ['p2', false],
    ])
    const summary = compareBaseline(
      [
        { id: 'p1', expectedSkills: ['r:x'], missing: [], outcome: 'grounded' },
        { id: 'p2', expectedSkills: ['r:x'], missing: [], outcome: 'grounded' },
        { id: 'p3', expectedSkills: ['r:x'], missing: [], outcome: 'loaded-missed' },
        { id: 'n', expectedSkills: ['r:x'], missing: [], outcome: null },
      ],
      control,
    )
    expect(summary).toEqual({
      cases: 2,
      groundedRecall: 1,
      controlRecall: 0.5,
      lift: 0.5,
      controlCaught: ['p1'],
    })
    expect(compareBaseline([], control)).toMatchObject({ lift: null, controlRecall: null })
    expect(baselineNotes([{ pillar: 'rules', baseline: summary }, { pillar: 'design' }])).toEqual([
      '- rules: control caught p1: does not discriminate',
    ])
  })

  it('adds control columns and notes to the summary and summary.json', () => {
    const d = deps(files)
    const markdown = scoreAll(cases, ['rules'], options(), d)
    expect(markdown).toContain('| Grounded recall | Control recall | Lift |')
    expect(markdown).toContain('- rules: control caught p1: does not discriminate')
    const [entry] = JSON.parse(d.readFile('out/summary.json'))
    expect(entry.summary.baseline).toMatchObject({ cases: 2, controlRecall: 0.5, lift: 0.5 })
  })

  it('omits the columns without a baseline', () => {
    const markdown = scoreAll(cases, ['rules'], options({ baseline: undefined }), deps(files))
    expect(markdown).not.toContain('Control recall')
  })

  it('errors when the baseline directory has no raw results', () => {
    expect(() => scoreAll(cases, ['rules'], options({ baseline: 'empty' }), deps(files))).toThrow(
      '--baseline empty has no raw results for these cases.',
    )
  })

  it('reads judge grades saved in the baseline, skipping results that are not judged', () => {
    const judged = (assignment: Array<number | null>) =>
      run([finding], [], {
        judged: {
          model: 'j',
          inputs: judgeInputs(expected as never, [finding] as never),
          assignment,
        },
      })
    const d = deps({
      'ctl/raw/rules/p1.json': judged([0]),
      'ctl/raw/rules/p2.json': judged([null]),
      'ctl/raw/rules/p3.json': run([finding]),
    })
    const control = readBaseline(cases, 'rules', 'ctl', 'j', d)
    expect([...control]).toEqual([
      ['p1', true],
      ['p2', false],
    ])
  })
})
