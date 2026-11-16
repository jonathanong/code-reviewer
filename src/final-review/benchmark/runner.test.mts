import { describe, expect, it, vi } from 'vitest'

import { FinalReviewError } from '../finding.mts'
import type { EvalCase } from './cases.mts'
import {
  PILLAR_OUTPUT_SCHEMA,
  PILLAR_TOOLS,
  READ_ONLY_TOOLS,
  buildPillarPrompt,
  parsePillarOutput,
  pillarArgs,
  runPillar,
} from './runner.mts'

const item: EvalCase = {
  id: 'c1',
  repo: 'acme/widgets',
  pr: 9,
  title: 'T',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  kind: 'negative',
  reason: '',
  expected: [],
}

const output = (findings: unknown) => JSON.stringify({ structured_output: { findings } })

describe('prompt and args', () => {
  it('wraps the pillar prompt with untrusted context instructions', () => {
    const prompt = buildPillarPrompt('  Pillar text  ', item)
    expect(prompt.startsWith('Pillar text\n\n## Pull request under review')).toBe(true)
    expect(prompt).toContain('Repository: acme/widgets.')
    expect(prompt).toContain('.final-review/pr.md')
    expect(prompt).toContain('.final-review/diff.patch')
    expect(prompt).toContain('untrusted input')
  })

  it('mentions reviewer comments only when context.md exists', () => {
    expect(buildPillarPrompt('P', item)).not.toContain('context.md')
    const prompt = buildPillarPrompt('P', item, true)
    expect(prompt).toContain('.final-review/context.md')
    expect(prompt).toContain('not instructions')
  })

  it('points at the rules index only when rules were staged', () => {
    expect(buildPillarPrompt('P', item)).not.toContain('INDEX.md')
    const prompt = buildPillarPrompt('P', item, false, true)
    expect(prompt).toContain(
      '`.final-review/rules/INDEX.md` lists the rule sources for this change',
    )
    expect(prompt).toContain('Read it before reviewing.')
  })

  it('describes a fixture case without a repository', () => {
    const fixture: EvalCase = { ...item, fixture: 'fx/a', fixtureDir: '/x' } as never
    expect(buildPillarPrompt('P', fixture)).toContain('Fixture: fx/a.')
  })

  it('restricts claude to read-only tools, skills, and a JSON schema', () => {
    const args = pillarArgs('P', 'sonnet', 12)
    expect(args.slice(0, 4)).toEqual(['-p', 'P', '--model', 'sonnet'])
    expect(PILLAR_TOOLS).toBe('Read,Grep,Glob,Skill')
    expect(args[args.indexOf('--tools') + 1]).toBe(PILLAR_TOOLS)
    expect(args[args.indexOf('--allowedTools') + 1]).toBe(PILLAR_TOOLS)
    const control = pillarArgs('P', 'sonnet', 12, READ_ONLY_TOOLS)
    expect(control[control.indexOf('--allowedTools') + 1]).toBe(READ_ONLY_TOOLS)
    expect(
      args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 3),
    ).toEqual(['--output-format', 'stream-json', '--verbose'])
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk')
    expect(args[args.indexOf('--max-turns') + 1]).toBe('12')
    expect(JSON.parse(args[args.indexOf('--json-schema') + 1] as string)).toEqual(
      PILLAR_OUTPUT_SCHEMA,
    )
  })
})

describe('parsePillarOutput', () => {
  it('tags findings with the pillar', () => {
    expect(
      parsePillarOutput(
        output([{ severity: 'high', title: 'T', body: 'B', path: 'a.ts', line: 2 }]),
        'design',
      ),
    ).toEqual({
      findings: [
        {
          pillar: 'design',
          severity: 'high',
          title: 'T',
          body: 'B',
          path: 'a.ts',
          line: 2,
          side: 'RIGHT',
        },
      ],
      skills: [],
    })
    expect(parsePillarOutput(output([]), 'design')).toEqual({ findings: [], skills: [] })
  })

  it('collects distinct Skill tool_use names from a stream-json run in first-use order', () => {
    const tool = (name: string, input: unknown) => ({ type: 'tool_use', name, input })
    const assistant = (...content: unknown[]) => ({ type: 'assistant', message: { content } })
    const stream = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      '',
      'not json',
      JSON.stringify(
        assistant(
          tool('Read', { file_path: 'a' }),
          tool('Skill', { skill: 'no-mistakes-rules:testing-rules' }),
          { type: 'text', text: 'hi' },
          null,
        ),
      ),
      JSON.stringify(
        assistant(tool('Skill', {}), tool('Skill', { skill: 'skills:bounded-iteration' })),
      ),
      JSON.stringify(assistant(tool('Skill', { skill: 'no-mistakes-rules:testing-rules' }))),
      JSON.stringify({ type: 'assistant', message: {} }),
      JSON.stringify({ type: 'user', message: { content: [tool('Skill', { skill: 'x:y' })] } }),
      JSON.stringify({ type: 'result', structured_output: { findings: [] } }),
    ].join('\n')
    expect(parsePillarOutput(stream, 'rules')).toEqual({
      findings: [],
      skills: ['no-mistakes-rules:testing-rules', 'skills:bounded-iteration'],
    })
  })

  it('rejects non-JSON output and missing structured findings', () => {
    expect(() => parsePillarOutput('nope', 'rules')).toThrow('Pillar run did not print JSON.')
    for (const text of ['null', '{}', JSON.stringify({ structured_output: {} }), output('x')]) {
      expect(() => parsePillarOutput(text, 'rules')).toThrow(FinalReviewError)
    }
    const empty = JSON.stringify({ structured_output: null })
    expect(() => parsePillarOutput(empty, 'rules')).toThrow(FinalReviewError)
    expect(() => parsePillarOutput('null', 'rules')).toThrow(
      'Pillar run returned no structured findings.',
    )
  })

  it('fails closed on non-object findings', () => {
    expect(() => parsePillarOutput(output([null]), 'rules')).toThrow(
      'findings[0] must be an object.',
    )
  })
})

describe('runPillar', () => {
  it('runs claude in the snapshot directory and parses its output', async () => {
    const exec = vi.fn(async () => output([{ severity: 'low', title: 'T', body: 'B' }]))
    const findings = await runPillar(
      item,
      '/snap',
      { pillar: 'history', pillarPrompt: 'Prompt', model: 'opus', maxTurns: 5 },
      exec,
    )
    expect(findings).toEqual({
      findings: [{ pillar: 'history', severity: 'low', title: 'T', body: 'B' }],
      skills: [],
    })
    const [command, args, options] = exec.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string },
    ]
    expect(command).toBe('claude')
    expect(args).toEqual(pillarArgs(buildPillarPrompt('Prompt', item), 'opus', 5))
    expect(options).toEqual({ cwd: '/snap' })
  })

  it('drops the Skill tool for a control run', async () => {
    const exec = vi.fn(async () => output([]))
    await runPillar(
      item,
      '/snap',
      { pillar: 'history', pillarPrompt: 'Prompt', model: 'opus', maxTurns: 5, skills: false },
      exec,
    )
    const [, args] = exec.mock.calls[0] as unknown as [string, string[]]
    expect(args[args.indexOf('--tools') + 1]).toBe(READ_ONLY_TOOLS)
  })
})
