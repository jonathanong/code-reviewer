import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runPillars } from './pillars.mts'
import { runReviewVerifier } from './verify-run.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const settings = { enabledPlugins: { 'ratchet-workflows@ratchet-stack': true } }
const analysis = { commands: ['graph dependents'], section: 'ANALYSIS SECTION' }
const answer = JSON.stringify({
  type: 'result',
  structured_output: { findings: [], summary: 's', pullRequestSummary: 'p', verdicts: [] },
})

const flag = (args: string[], name: string) => args[args.indexOf(name) + 1]

/** A shell grant makes the Claude adapter pass `--setting-sources ''`; the plugin `--settings` must stay. */
function expectPluginSettingsKept(args: string[]) {
  expect(flag(args, '--allowedTools')).toContain('Bash(graph dependents:*)')
  expect(flag(args, '--allowedTools')).toContain('Skill')
  expect(flag(args, '--setting-sources')).toBe('')
  expect(JSON.parse(flag(args, '--settings') as string)).toEqual(settings)
}

describe('analysis with rule plugin settings', () => {
  it('keeps the plugin settings and the Skill tool on a pillar', async () => {
    const out = mkdtempSync(join(tmpdir(), 'analysis-argv-'))
    dirs.push(out)
    const exec = vi.fn(async (_command: string, _args: string[]) => answer)
    await runPillars({
      pillars: [{ pillar: 'rules', model: 'sonnet' }],
      tree: '/tree',
      run: { out, sinceSha: null, hasRules: true },
      mode: 'full',
      jobs: 1,
      contract: 'C',
      readPillar: () => 'P',
      skills: [],
      settings,
      analysis,
      exec,
    })
    expect(exec).toHaveBeenCalledTimes(1)
    expectPluginSettingsKept(exec.mock.calls[0]?.[1] as string[])
  })

  it('keeps the plugin settings and the Skill tool on the verifier', async () => {
    const exec = vi.fn(async (_command: string, _args: string[]) => answer)
    await runReviewVerifier(
      {
        verifierPrompt: 'V',
        references: '/refs',
        run: { out: '/run', sinceSha: null, hasRules: true },
        findings: [],
        skipped: [],
        threads: [],
        analysis,
      },
      { model: 'opus', mode: 'full', tree: '/tree', settings, exec },
    )
    expect(exec).toHaveBeenCalledTimes(1)
    expectPluginSettingsKept(exec.mock.calls[0]?.[1] as string[])
  })
})
