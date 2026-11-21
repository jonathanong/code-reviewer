import { describe, expect, it, vi } from 'vitest'

import type { Finding } from '../finding.mts'
import type { EvidenceSource } from '../rules/evidence-parse.mts'
import { claudeTools } from '../../harness/claude-args.mts'
import { evidenceCapabilities } from './pillar-capabilities.mts'
import {
  EVIDENCE_MODEL,
  buildEvidenceRunPrompt,
  evidenceEnv,
  runEvidenceModel,
  type UsableSource,
} from './evidence-run.mts'

const source = (name: string, commands: string[], env: Record<string, string>): EvidenceSource => ({
  name,
  description: `${name} data.`,
  guide: { file: '/g.md' },
  commands,
  env,
})

const AWS: UsableSource = {
  source: source('aws', ['aws logs filter-log-events', 'aws cloudwatch get-metric-data'], {
    AWS_PROFILE: 'secret-profile',
  }),
  guide: 'Use the /app log group.',
}
const DD: UsableSource = {
  source: source('dd', ['dogctl metrics query', 'aws logs filter-log-events'], { DD_SITE: 'eu' }),
  guide: 'Scope by service.',
}

const FINDINGS: Finding[] = [
  {
    pillar: 'correctness',
    severity: 'high',
    title: 'Retries loop',
    body: 'Retries forever.',
    path: 'a.ts',
  },
  { pillar: 'design', severity: 'low', title: 'Nit', body: 'Rename it.' },
]

const INPUT = {
  prompt: 'EVIDENCE prompt text',
  title: 'Add retries',
  pullRequestSummary: 'It adds retries.',
  findings: FINDINGS,
  sources: [AWS, DD],
}

const OPTIONS = { mode: 'full' as const, tree: '/tree' }

const ANSWER = {
  sources: [
    {
      name: 'aws',
      status: 'checked',
      queries: [{ command: 'aws logs filter-log-events', result: '0' }],
    },
    { name: 'dd', status: 'not-applicable', reason: 'No metrics.', queries: [] },
  ],
  findings: [{ id: 'F1', effect: 'contradicts', note: 'Never retried.' }],
  claims: [],
}

const result = (structured: unknown, cost = 0.4) =>
  JSON.stringify({
    type: 'result',
    total_cost_usd: cost,
    num_turns: 3,
    structured_output: structured,
  })

describe('evidence tool grants', () => {
  it('offers Bash and allows only the given prefixes, once each, beside the read tools', () => {
    expect(
      claudeTools(
        evidenceCapabilities(['aws logs get-query-results', 'aws logs get-query-results']),
      ),
    ).toEqual({
      tools: 'Read,Grep,Glob,Bash',
      allowedTools: 'Read,Grep,Glob,Bash(aws logs get-query-results:*)',
    })
  })
})

describe('evidenceEnv', () => {
  it('merges every source env', () => {
    expect(evidenceEnv([AWS.source, DD.source])).toEqual({
      AWS_PROFILE: 'secret-profile',
      DD_SITE: 'eu',
    })
  })
})

describe('buildEvidenceRunPrompt', () => {
  const prompt = buildEvidenceRunPrompt(INPUT)

  it('gives the run the prompt, the findings by id, and each source with its guide and commands', () => {
    expect(prompt.startsWith('EVIDENCE prompt text')).toBe(true)
    expect(prompt).toContain('"id": "F1"')
    expect(prompt).toContain('"id": "F2"')
    expect(prompt).toContain('Retries forever.')
    expect(prompt).toContain('Pull request: Add retries')
    expect(prompt).toContain('### aws')
    expect(prompt).toContain('Applies to: aws data.')
    expect(prompt).toContain('`aws logs filter-log-events`, `aws cloudwatch get-metric-data`')
    expect(prompt).toContain('Use the /app log group.')
    expect(prompt).toContain('Scope by service.')
  })

  it('never includes an env value', () => {
    expect(prompt).not.toContain('secret-profile')
  })

  it('gives the current time from the injected clock as ISO UTC, seconds, and milliseconds', () => {
    const at = new Date('2026-03-04T05:06:07.089Z')
    expect(buildEvidenceRunPrompt(INPUT, at)).toContain(
      'Current time: 2026-03-04T05:06:07.089Z (UTC), 1772600767 epoch seconds, 1772600767089 epoch milliseconds.',
    )
    expect(prompt).toMatch(/Current time: \d{4}-\d\d-\d\dT/u)
  })

  it('says so when there is no summary', () => {
    expect(buildEvidenceRunPrompt({ ...INPUT, pullRequestSummary: '' })).toContain('(no summary)')
  })
})

describe('runEvidenceModel', () => {
  it('runs sonnet in the tree with only the configured commands and the sources env', async () => {
    const exec = vi.fn(async () => result(ANSWER))
    const run = await runEvidenceModel(INPUT, {
      ...OPTIONS,
      exec,
      settings: { enabledPlugins: {} },
      now: () => new Date('2026-03-04T05:06:07.089Z'),
    })
    expect(exec).toHaveBeenCalledOnce()
    const [command, args, options] = exec.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string; env: Record<string, string> },
    ]
    const flag = (name: string) => args[args.indexOf(name) + 1]
    expect(command).toBe('claude')
    expect(args.join('\n')).toContain('1772600767089 epoch milliseconds')
    expect(flag('--model')).toBe(EVIDENCE_MODEL)
    expect(flag('--tools')).toBe('Read,Grep,Glob,Bash')
    expect(flag('--allowedTools')).toBe(
      'Read,Grep,Glob,Bash(aws logs filter-log-events:*),Bash(aws cloudwatch get-metric-data:*),Bash(dogctl metrics query:*)',
    )
    expect(flag('--permission-mode')).toBe('dontAsk')
    expect(args).toContain('--strict-mcp-config')
    expect(flag('--settings')).toBe('{"enabledPlugins":{}}')
    expect(args).not.toContain('--agents')
    expect(options.cwd).toBe('/tree')
    expect(options.env).toEqual({ AWS_PROFILE: 'secret-profile', DD_SITE: 'eu' })
    expect(args.join(' ')).not.toContain('secret-profile')
    expect('output' in run && run.output.findings).toEqual([
      { id: 'F1', effect: 'contradicts', note: 'Never retried.' },
    ])
    expect('usage' in run && run.usage.costUsd).toBe(0.4)
  })

  it('retries once after an invalid answer and keeps the failed attempt cost', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(
        result(
          { sources: [{ name: 'aws', status: 'checked', queries: [] }], findings: [], claims: [] },
          0.3,
        ),
      )
      .mockResolvedValueOnce(result(ANSWER))
    const run = await runEvidenceModel(INPUT, { ...OPTIONS, exec })
    expect(exec).toHaveBeenCalledTimes(2)
    expect('output' in run).toBe(true)
    expect(run.failedAttempts).toHaveLength(1)
    expect(run.failedAttempts[0]?.error).toContain('checked without a recorded query')
    expect(run.failedAttempts[0]?.usage?.costUsd).toBe(0.3)
  })

  it('reports the error after two failures and never throws', async () => {
    const exec = vi.fn(async () => 'not json')
    const run = await runEvidenceModel(INPUT, { ...OPTIONS, exec })
    expect(exec).toHaveBeenCalledTimes(2)
    expect(run).toMatchObject({ error: 'Evidence run did not print JSON.' })
    expect(run.failedAttempts).toHaveLength(2)
  })

  it('records a crashed run without usage', async () => {
    const exec = vi.fn(async () => {
      throw new Error('claude crashed')
    })
    const run = await runEvidenceModel(INPUT, { ...OPTIONS, exec })
    expect(run).toMatchObject({ error: 'claude crashed' })
    expect(run.failedAttempts.map((attempt) => attempt.usage)).toEqual([null, null])
  })
})
