import { describe, expect, it } from 'vitest'

import { ReviewError } from '../finding.mts'
import { parsePillarOutput, readStream } from './stream-output.mts'

const NO_USAGE = {
  costUsd: null,
  turns: null,
  durationMs: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheCreationTokens: null,
  byModel: {},
}

const output = (findings: unknown) => JSON.stringify({ structured_output: { findings } })

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
      usage: NO_USAGE,
    })
    expect(parsePillarOutput(output([]), 'design')).toEqual({
      findings: [],
      skills: [],
      usage: NO_USAGE,
    })
  })

  it('collects distinct, successfully loaded Skill names from a stream-json run in first-use order', () => {
    const tool = (name: string, input: unknown, id?: string) => ({
      type: 'tool_use',
      name,
      input,
      id,
    })
    const done = (id: string, error?: boolean) => ({
      type: 'tool_result',
      tool_use_id: id,
      is_error: error,
    })
    const assistant = (...content: unknown[]) => ({ type: 'assistant', message: { content } })
    const user = (...content: unknown[]) => ({ type: 'user', message: { content } })
    const testing = { skill: 'no-mistakes-rules:testing-rules' }
    const stream = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      '',
      'not json',
      JSON.stringify(
        assistant(
          tool('Read', { file_path: 'a' }, 'r1'),
          tool('Skill', testing, 's1'),
          { type: 'text', text: 'hi' },
          null,
        ),
      ),
      JSON.stringify(user(done('r1'), done('s1'))),
      JSON.stringify(
        assistant(
          tool('Skill', {}, 's2'),
          tool('Skill', { skill: 'skills:bounded-iteration' }, 's3'),
          tool('Skill', { skill: 'missing:skill' }, 's4'),
          tool('Skill', { skill: 'never:answered' }, 's5'),
        ),
      ),
      JSON.stringify(user(done('s2'), done('s3', false), done('s4', true))),
      JSON.stringify(assistant(tool('Skill', testing, 's6'))),
      JSON.stringify(user(done('s6'))),
      JSON.stringify({ type: 'assistant', message: {} }),
      JSON.stringify(user(tool('Skill', { skill: 'x:y' }, 's7'), done('s7'))),
      JSON.stringify({ type: 'result', structured_output: { findings: [] } }),
    ].join('\n')
    expect(parsePillarOutput(stream, 'rules')).toEqual({
      findings: [],
      skills: ['no-mistakes-rules:testing-rules', 'skills:bounded-iteration'],
      usage: NO_USAGE,
    })
  })

  it('reads usage from the final result event', () => {
    const stream = [
      JSON.stringify({ type: 'assistant', message: { content: [] } }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        num_turns: 7,
        duration_ms: 1234,
        total_cost_usd: 0.42,
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 300,
          cache_creation_input_tokens: 40,
        },
        structured_output: { findings: [] },
      }),
    ].join('\n')
    expect(parsePillarOutput(stream, 'rules').usage).toEqual({
      costUsd: 0.42,
      turns: 7,
      durationMs: 1234,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 300,
      cacheCreationTokens: 40,
      byModel: {},
    })
  })

  it('keeps what an old single-object result has and nulls the rest', () => {
    const old = JSON.stringify({
      type: 'result',
      total_cost_usd: 1.5,
      usage: { input_tokens: 'many' },
      structured_output: { findings: [] },
    })
    expect(parsePillarOutput(old, 'rules').usage).toEqual({ ...NO_USAGE, costUsd: 1.5 })
  })

  it('rejects non-JSON output and missing structured findings', () => {
    expect(() => parsePillarOutput('nope', 'rules')).toThrow('Pillar run did not print JSON.')
    for (const text of ['null', '{}', JSON.stringify({ structured_output: {} }), output('x')]) {
      expect(() => parsePillarOutput(text, 'rules')).toThrow(ReviewError)
    }
    const empty = JSON.stringify({ structured_output: null })
    expect(() => parsePillarOutput(empty, 'rules')).toThrow(ReviewError)
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

describe('a run with a subagent', () => {
  const early = JSON.stringify({
    type: 'result',
    total_cost_usd: 0.1,
    num_turns: 2,
    structured_output: { findings: [{ severity: 'low', title: 'early', body: 'b' }] },
  })
  const nullAnswer = JSON.stringify({
    type: 'result',
    total_cost_usd: 0.2,
    structured_output: null,
  })
  const last = JSON.stringify({
    type: 'result',
    total_cost_usd: 0.9,
    num_turns: 8,
    structured_output: { findings: [{ severity: 'high', title: 'final', body: 'b' }] },
  })

  it('takes findings from the last event with structured output and usage from the last result', () => {
    const parsed = parsePillarOutput([early, last].join('\n'), 'design')
    expect(parsed.findings.map((finding) => finding.title)).toEqual(['final'])
    expect(parsed.usage.costUsd).toBe(0.9)
    expect(parsed.usage.turns).toBe(8)
  })

  it('skips a trailing result whose structured output is null but takes its usage', () => {
    const parsed = parsePillarOutput([early, nullAnswer].join('\n'), 'design')
    expect(parsed.findings.map((finding) => finding.title)).toEqual(['early'])
    expect(parsed.usage.costUsd).toBe(0.2)
  })

  it('returns undefined structured output when no event has any', () => {
    const stream = readStream(JSON.stringify({ type: 'assistant', message: {} }), 'Run')
    expect(stream).toEqual({ structured: undefined, skills: [], usage: NO_USAGE })
  })
})
