import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import { ReviewError } from '../finding.mts'
import { resolveModelPlan } from '../models.mts'
import { extraPillar } from '../pillar-name.mts'
import type { ExtraPillarConfig } from '../rules/pillars-parse.mts'
import { APPROVAL_CHECK_SCHEMA } from './approval-check-prompt.mts'
import { buildExtraPillarPrompt } from './extra-pillar-prompt.mts'
import { withExtraPillars } from './extra-pillar-schema.mts'
import { runPillars } from './pillars.mts'
import { requireAnswer } from './require-answer.mts'
import { REVIEW_VERIFIER_SCHEMA } from './verify.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const prompted = (overrides: Partial<ExtraPillarConfig> = {}): ExtraPillarConfig => ({
  name: extraPillar('a11y'),
  modes: ['full'],
  source: { prompt: 'Look for missing labels.' },
  ...overrides,
})
const command: ExtraPillarConfig = {
  name: extraPillar('native'),
  modes: ['full'],
  source: { run: '/code-review low' },
}
const common = {
  contract: ' CONTRACT ',
  run: { out: '/o', sinceSha: null, hasRules: false },
  skills: [],
}

describe('buildExtraPillarPrompt', () => {
  it('builds a prompt pillar like a built-in one: contract, instructions, then the run section', () => {
    const prompt = buildExtraPillarPrompt(prompted(), common)
    const order = ['CONTRACT', '# Pillar: a11y', 'Look for missing labels.', '## This run']
    const at = order.map((part) => prompt.indexOf(part))
    expect(at.every((index) => index >= 0)).toBe(true)
    expect(at).toEqual(at.toSorted((a, b) => a - b))
    expect(prompt).not.toContain('applies only when')
  })

  it('puts the trigger at the top of the pillar text and tells it to return no findings otherwise', () => {
    const prompt = buildExtraPillarPrompt(prompted({ when: 'the change touches UI' }), common)
    const trigger = prompt.indexOf('This pillar applies only when: the change touches UI')
    expect(trigger).toBeGreaterThan(prompt.indexOf('# Pillar: a11y'))
    expect(trigger).toBeLessThan(prompt.indexOf('Look for missing labels.'))
    expect(prompt).toContain('return an empty findings array and stop')
  })

  it('sends a run command as the whole prompt, followed by the contract', () => {
    expect(buildExtraPillarPrompt(command, common)).toBe('/code-review low\n\nCONTRACT')
  })
})

describe('withExtraPillars', () => {
  const pillarEnum = (schema: object) =>
    (
      schema as {
        properties: { findings: { items: { properties: { pillar: { enum: string[] } } } } }
      }
    ).properties.findings.items.properties.pillar.enum

  it('is the very same schema without extras, so the default call does not change', () => {
    expect(withExtraPillars(REVIEW_VERIFIER_SCHEMA, [])).toBe(REVIEW_VERIFIER_SCHEMA)
    expect(withExtraPillars(APPROVAL_CHECK_SCHEMA, [])).toBe(APPROVAL_CHECK_SCHEMA)
  })

  it('adds the names to the pillar enum and leaves the rest of the schema alone', () => {
    const schema = withExtraPillars(REVIEW_VERIFIER_SCHEMA, ['a11y'])
    expect(pillarEnum(schema)).toEqual([...pillarEnum(REVIEW_VERIFIER_SCHEMA), 'a11y'])
    expect(pillarEnum(REVIEW_VERIFIER_SCHEMA)).not.toContain('a11y')
    expect(Object.keys(schema)).toEqual(Object.keys(REVIEW_VERIFIER_SCHEMA))
    expect(pillarEnum(withExtraPillars(APPROVAL_CHECK_SCHEMA, ['a11y']))).toContain('a11y')
  })
})

const answer = (findings: unknown[]) =>
  JSON.stringify({
    type: 'result',
    total_cost_usd: 0.5,
    num_turns: 2,
    structured_output: { findings },
  })

function setup(exec: Exec, extra: ExtraPillarConfig[], models?: object) {
  const out = mkdtempSync(join(tmpdir(), 'extra-pillars-'))
  dirs.push(out)
  return {
    out,
    input: {
      pillars: [
        { pillar: 'rules' as const, model: 'sonnet' as const },
        ...extra.map((entry) => ({ pillar: entry.name, model: 'sonnet' as const })),
      ],
      extra,
      tree: '/tree',
      run: { out, sinceSha: null, hasRules: false },
      mode: 'full' as const,
      jobs: 2,
      contract: 'CONTRACT',
      readPillar: (pillar: string) => `PILLAR ${pillar}`,
      skills: ['skills:documentation'],
      exec,
      ...(models === undefined ? {} : { models: models as never }),
    },
  }
}
const argsOf = (call: unknown) => (call as unknown as [string, string[]])[1] as string[]
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1]

describe('runPillars with configured pillars', () => {
  it('runs an extra as its own step with the read-only preset, and tags its findings with its name', async () => {
    const exec = vi.fn(async (_command: string, args: string[]) =>
      (args[1] as string).includes('Look for missing labels.')
        ? answer([{ severity: 'high', title: 'No label', body: 'b', path: 'a.tsx', line: 2 }])
        : answer([]),
    )
    const { out, input } = setup(exec, [prompted()])
    const results = await runPillars(input)
    expect(results.map((result) => result.pillar)).toEqual(['rules', 'a11y'])
    expect(results[1]?.findings).toEqual([
      expect.objectContaining({ pillar: 'a11y', title: 'No label' }),
    ])
    const args = argsOf(exec.mock.calls.find((call) => (call[1] as string[])[1]?.includes('a11y')))
    expect(flag(args, '--tools')).toBe('Read,Grep,Glob,Agent,Skill')
    expect(flag(args, '--allowedTools')).toBe('Read,Grep,Glob,Agent,Skill')
    const saved = JSON.parse(readFileSync(join(out, 'pillars', 'a11y.json'), 'utf8'))
    expect(saved).toMatchObject({ pillar: 'a11y', model: 'sonnet', failedAttempts: [] })
  })

  it('gives an extra no web tool even when references are configured', async () => {
    const exec = vi.fn(async (_command: string, _args: string[]) => answer([]))
    const { input } = setup(exec, [prompted()])
    await runPillars({
      ...input,
      web: {
        sources: [{ name: 'x', description: 'X', domains: ['x.example.com'] }],
        guidance: 'W',
      },
    })
    const args = argsOf(exec.mock.calls.find((call) => (call[1] as string[])[1]?.includes('a11y')))
    expect(flag(args, '--allowedTools')).not.toContain('WebFetch')
    expect(args.join(' ')).not.toContain('x.example.com')
  })

  it('sends a run pillar the command and the contract only', async () => {
    const exec = vi.fn(async (_command: string, _args: string[]) => answer([]))
    await runPillars(setup(exec, [command]).input)
    const call = exec.mock.calls.find((entry) =>
      (entry[1] as string[])[1]?.startsWith('/code-review'),
    )
    expect(argsOf(call)[1]).toBe('/code-review low\n\nCONTRACT')
  })

  it('resolves the model from pillar.<name>, then pillars, then the medium tier', async () => {
    const exec = vi.fn(async (_command: string, _args: string[]) => answer([]))
    const modelOf = async (
      steps: Record<string, 'small' | { harness: string; model: string }[]>,
    ) => {
      exec.mockClear()
      const models = { plan: resolveModelPlan({ steps: steps as never }) }
      await runPillars(setup(exec, [prompted()], models).input)
      const call = exec.mock.calls.find((entry) => (entry[1] as string[])[1]?.includes('a11y'))
      return flag(argsOf(call), '--model')
    }
    expect(await modelOf({})).toBe('sonnet')
    expect(await modelOf({ pillars: [{ harness: 'claude', model: 'opus' }] })).toBe('opus')
    expect(
      await modelOf({
        pillars: [{ harness: 'claude', model: 'opus' }],
        'pillar.a11y': [{ harness: 'claude', model: 'haiku' }],
      }),
    ).toBe('haiku')
  })

  it('reports an extra that fails twice and still returns the other pillars', async () => {
    const exec = vi.fn(async (_command: string, args: string[]) => {
      if ((args[1] as string).includes('Look for missing labels.')) return 'not json'
      return answer([])
    })
    const results = await runPillars(setup(exec, [prompted()]).input)
    expect(results[0]).toMatchObject({ pillar: 'rules', findings: [] })
    expect(results[0]?.error).toBeUndefined()
    expect(results[1]?.pillar).toBe('a11y')
    expect(results[1]?.error).toEqual(expect.any(String))
    expect(results[1]?.failedAttempts).toHaveLength(2)
  })
})

describe('requireAnswer', () => {
  const ok = { pillar: 'rules', error: undefined } as never
  const failed = { pillar: 'a11y', error: 'boom\nmore' } as never

  it('accepts a review where any pillar answered', () => {
    expect(() => requireAnswer([ok, failed])).not.toThrow()
  })

  it('fails closed when every pillar failed, naming each', () => {
    expect(() => requireAnswer([failed])).toThrow(
      new ReviewError('Every pillar failed: a11y (boom)'),
    )
  })

  it('fails when the config left no pillar for the change', () => {
    expect(() => requireAnswer([])).toThrow(/No pillar is planned for this change/u)
  })
})
