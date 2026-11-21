import { describe, expect, it } from 'vitest'

import { claudeArgs } from '../../harness/claude-args.mts'
import { readResult } from '../../harness/claude-stream.mts'
import type { Finding } from '../finding.mts'
import { buildCheckPrompt, checkFindings, checkRequest, parseChecks } from './verifier-check.mts'

const finding = (title: string): Finding => ({
  pillar: 'design',
  severity: 'high',
  title,
  body: 'b',
})

const parse = (stdout: string, indexes: readonly number[]) =>
  parseChecks(readResult(stdout).structured, indexes)

const out = (verdicts: unknown, costUsd?: number) =>
  JSON.stringify({ type: 'result', total_cost_usd: costUsd, structured_output: { verdicts } })

describe('verifier check', () => {
  it('lists only the requested findings with their output index', () => {
    const prompt = buildCheckPrompt([finding('a'), finding('b')], [1])
    expect(prompt).toContain('"index": 1')
    expect(prompt).toContain('"title": "b"')
    expect(prompt).not.toContain('"title": "a"')
  })

  it('points at the rules index only when rules are staged', () => {
    expect(buildCheckPrompt([finding('a')], [0])).not.toContain('rules/INDEX.md')
    expect(buildCheckPrompt([finding('a')], [0], true)).toContain('rules/INDEX.md')
  })

  it('passes read-only tools and the schema', () => {
    const args = claudeArgs(checkRequest('P', 'opus', 7))
    expect(args.slice(0, 4)).toEqual(['-p', 'P', '--model', 'opus'])
    expect(args[args.indexOf('--max-turns') + 1]).toBe('7')
    expect(args).toContain('--strict-mcp-config')
    expect(args).not.toContain('--settings')
    const settings = { enabledPlugins: { 'skills@m': true } }
    const isolated = claudeArgs(checkRequest('P', 'opus', 7, false, settings))
    expect(JSON.parse(isolated[isolated.indexOf('--settings') + 1] as string)).toEqual(settings)
    expect(args).toContain('Read,Grep,Glob')
    expect(claudeArgs(checkRequest('P', 'opus', 7, true))).toContain('Read,Grep,Glob,Skill')
    expect(JSON.parse(args[args.indexOf('--json-schema') + 1] as string).required).toEqual([
      'verdicts',
    ])
  })

  it('keeps the first verdict per listed index', () => {
    const checks = parse(
      out([
        { index: 1, holds: false, reason: 'no' },
        { index: 1, holds: true, reason: 'dup' },
        { index: 9, holds: true, reason: 'unlisted' },
      ]),
      [1, 2],
    )
    expect([...checks]).toEqual([[1, { holds: false, reason: 'no' }]])
    expect(() => parse('null', [1])).toThrow('no verdicts')
    expect(() => parse(out('x'), [1])).toThrow('no verdicts')
  })

  it('drops malformed verdicts so their findings stay unchecked', () => {
    const checks = parse(
      out([
        null,
        'x',
        { index: '1', holds: true, reason: 'index' },
        { index: 1, reason: 'no holds' },
        { index: 1, holds: true },
        { index: 2, holds: true, reason: 'valid' },
      ]),
      [1, 2],
    )
    expect([...checks]).toEqual([[2, { holds: true, reason: 'valid' }]])
  })

  it('skips the call with nothing to check and runs in the snapshot otherwise', async () => {
    const cwds: Array<string | undefined> = []
    const exec = async (_command: string, _args: string[], options?: { cwd?: string }) => {
      cwds.push(options?.cwd)
      return out([{ index: 0, holds: true, reason: 'yes' }], 0.25)
    }
    const run = { model: 'opus', maxTurns: 3 }
    const none = await checkFindings('/snap', [finding('a')], [], run, exec)
    expect(none.checks.size).toBe(0)
    expect(none.usage).toBeNull()
    expect(cwds).toEqual([])
    const { checks, usage } = await checkFindings('/snap', [finding('a')], [0], run, exec)
    expect(checks.get(0)).toEqual({ holds: true, reason: 'yes' })
    expect(usage?.costUsd).toBe(0.25)
    expect(cwds).toEqual(['/snap'])
  })
})
