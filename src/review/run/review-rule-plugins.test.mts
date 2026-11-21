import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import type { PluginInfo } from '../plugins.mts'
import type { ReviewPlan } from '../plan.mts'
import { runReview, type ReviewSteps } from './review.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const PLAN: ReviewPlan = {
  upToDate: false,
  mode: 'full',
  effort: 'high',
  sinceSha: null,
  pillars: [{ pillar: 'rules', model: 'sonnet' }],
  verifierModel: 'opus',
  skipped: [],
  reasons: [],
}
const result = (structured: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0, num_turns: 1, structured_output: structured })

const SKILLS = { name: 'jong-skills', installPath: fixture('plugins/skills') }
const WITH_SKILLS: PluginInfo = {
  enabled: [
    { id: 'jong-skills@m', version: '1' },
    { id: 'no-mistakes-rules@m', version: '1' },
  ],
  installs: [SKILLS],
}

/** Runs a review with a fake `claude`; returns the outcome, the run directory and every call's arguments. */
async function run(rulePlugins: readonly string[], plugins: PluginInfo) {
  const out = mkdtempSync(join(tmpdir(), 'review-rules-'))
  dirs.push(out)
  const seen: string[][] = []
  const exec: Exec = async (_command, args) => {
    seen.push(args)
    if (args[args.indexOf('--tools') + 1] === '') {
      return result({ skills: ['jong-skills:documentation'] })
    }
    if ((args[1] as string).includes('VERIFIER prompt text')) {
      return result({ summary: 's', pullRequestSummary: 'p', findings: [] })
    }
    return result({ findings: [] })
  }
  const abort = vi.fn(async () => undefined)
  const steps = {
    claim: async () => ({ claimed: true }),
    prepare: async () => {
      mkdirSync(join(out, 'diff'), { recursive: true })
      writeFileSync(join(out, 'diff', 'INDEX.md'), '- a.ts')
      writeFileSync(join(out, 'diff.patch'), 'diff --git a/a.ts b/a.ts\n+x\n')
      writeFileSync(join(out, 'context.json'), JSON.stringify({ title: 'T' }))
      return { headSha: 'd'.repeat(40), plan: PLAN }
    },
    abort,
    preview: async () => ({ verdict: 'Approve', reviews: [] }),
    plugins: async () => plugins,
    evidence: async () => ({ sources: [], readGuide: async () => '' }),
    approvalCheck: false,
    rulePlugins,
    exec,
    references: fixture('references'),
  } as unknown as ReviewSteps
  const outcome = await runReview(steps, {
    repo: 'acme/widgets',
    pr: 4,
    out,
    tree: '/tree',
    jobs: 1,
  })
  return { outcome, out, seen, abort }
}

const pillarCalls = (seen: string[][]) =>
  seen.filter((args) => (args[1] as string).includes('rules prompt text'))
const settingsOf = (args: string[]) => args[args.indexOf('--settings') + 1]

describe('runReview rule plugins', () => {
  it('gives a default run the pillar contract as it is on disk, and the default plugins on', async () => {
    const { outcome, seen } = await run(['no-mistakes-rules', 'jong-skills'], {
      ...WITH_SKILLS,
      installs: [
        SKILLS,
        { name: 'no-mistakes-rules', installPath: fixture('plugins/no-mistakes-rules') },
      ],
    })
    expect(outcome.ok).toBe(true)
    const [pillar] = pillarCalls(seen) as string[][]
    expect(pillar?.[1]).toContain(
      '_contract prompt text\n\n- Shared rule skills: from the `no-mistakes-rules` and `jong-skills` plugins.\n- Other input.',
    )
    expect(settingsOf(pillar as string[])).toBe(
      JSON.stringify({ enabledPlugins: { 'jong-skills@m': true, 'no-mistakes-rules@m': true } }),
    )
  })

  it('renders the configured plugins into the pillar prompt and turns the others off', async () => {
    const { outcome, seen } = await run(['jong-skills'], WITH_SKILLS)
    expect(outcome.ok).toBe(true)
    const [pillar] = pillarCalls(seen) as string[][]
    expect(pillar?.[1]).toContain('- Shared rule skills: from the `jong-skills` plugin.')
    expect(pillar?.[1]).toContain(
      'A pillar file may name a skill from a plugin this run does not load',
    )
    expect(settingsOf(pillar as string[])).toBe(
      JSON.stringify({ enabledPlugins: { 'jong-skills@m': true, 'no-mistakes-rules@m': false } }),
    )
  })

  it('selects no skills and calls no selection model when the list is empty', async () => {
    const { outcome, out, seen } = await run([], { ...WITH_SKILLS, installs: [] })
    expect(outcome.ok).toBe(true)
    expect(JSON.parse(readFileSync(join(out, 'skills.json'), 'utf8'))).toEqual({
      selected: [],
      available: 0,
      usage: null,
    })
    expect(seen.some((args) => args[args.indexOf('--tools') + 1] === '')).toBe(false)
    const pillars = pillarCalls(seen)
    expect(pillars).toHaveLength(1)
    const [pillar] = pillars as string[][]
    expect(settingsOf(pillar as string[])).toBe(
      JSON.stringify({ enabledPlugins: { 'jong-skills@m': false, 'no-mistakes-rules@m': false } }),
    )
    expect(pillar?.[1]).toContain('no shared rule plugins are configured')
    expect(pillar?.[1]).not.toContain('no-mistakes-rules')
    expect(pillar?.[1]).not.toContain('Skill tool once')
  })

  it('fails before any model call naming a configured plugin not enabled at user scope', async () => {
    const { outcome, seen, abort } = await run(['no-mistakes-rules', 'jong-skills'], WITH_SKILLS)
    expect(outcome.ok).toBe(false)
    expect(outcome.summary.error).toBe(
      'rule plugins missing or not enabled at user scope: no-mistakes-rules',
    )
    expect(seen).toEqual([])
    expect(abort).toHaveBeenCalledTimes(1)
  })

  describe('a non-empty list that yields no skills', () => {
    it('still fails the review', async () => {
      const plugins = {
        enabled: [],
        installs: [{ name: 'other', installPath: fixture('plugins/missing') }],
      }
      const { outcome, out, seen } = await run(['other'], plugins)
      expect(outcome.ok).toBe(false)
      expect(outcome.summary.error).toBe(
        'Skill selection failed, so no review was run: No rule skills are installed.',
      )
      expect(JSON.parse(readFileSync(join(out, 'skills.json'), 'utf8')).error).toBe(
        'No rule skills are installed.',
      )
      expect(seen).toEqual([])
    })
  })
})
