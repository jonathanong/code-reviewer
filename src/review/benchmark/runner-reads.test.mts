import { describe, expect, it } from 'vitest'

import type { EvalCase } from './cases.mts'
import { runPillar } from './runner.mts'

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

const reading = (...paths: string[]) =>
  [
    ...paths.flatMap((path, at) => [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: path }, id: `r${at}` }],
        },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: `r${at}` }] },
      },
    ]),
    { type: 'result', structured_output: { findings: [] } },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n')

describe('runPillar reads', () => {
  it('makes a read inside the snapshot relative and leaves any other path as it was', async () => {
    const stdout = reading(
      '/snap/src/a.ts',
      '/snap',
      '/snapshot/b.ts',
      '/etc/c',
      'rel/d.ts',
      '/snap/../x',
    )
    const run = { pillar: 'design' as const, pillarPrompt: 'P', model: 'opus', maxTurns: 5 }
    const output = await runPillar(item, '/snap', run, async () => stdout)
    expect(output.reads).toEqual([
      'src/a.ts',
      '/snap',
      '/snapshot/b.ts',
      '/etc/c',
      'rel/d.ts',
      '/snap/../x',
    ])
  })
})
