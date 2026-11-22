import { describe, expect, it } from 'vitest'

import { readStream } from './claude-stream.mts'

const use = (name: string, input: unknown, id: string, extra: object = {}) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', name, input, id }] },
  ...extra,
})
const done = (id: string, isError?: boolean) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] },
})
const stream = (...events: object[]) => events.map((event) => JSON.stringify(event)).join('\n')

describe('readStream reads and searches', () => {
  it('collects distinct files read and searches made, in first-use order', () => {
    const run = readStream(
      stream(
        use('Read', { file_path: '/r/b.ts' }, 'r1'),
        use('Grep', { pattern: 'retry', path: 'src', glob: '*.ts' }, 'g1'),
        use('Glob', { pattern: '**/*.md' }, 'g2'),
        done('r1'),
        done('g1'),
        done('g2'),
        use('Read', { file_path: '/r/a.ts' }, 'r2'),
        use('Read', { file_path: '/r/b.ts' }, 'r3'),
        use('Grep', { pattern: 'retry', path: 'src', glob: '*.ts' }, 'g3'),
        done('r2'),
        done('r3'),
        done('g3'),
        { type: 'result', structured_output: { findings: [] } },
      ),
      'Run',
    )
    expect(run.reads).toEqual(['/r/b.ts', '/r/a.ts'])
    expect(run.searches).toEqual(['retry in src glob *.ts', '**/*.md'])
  })

  it('skips calls that failed, never answered, or name nothing, and other tools', () => {
    const run = readStream(
      stream(
        use('Read', { file_path: '/r/failed.ts' }, 'r1'),
        use('Read', { file_path: '/r/silent.ts' }, 'r2'),
        use('Read', {}, 'r3'),
        use('Grep', { path: 'src' }, 'g1'),
        use('Grep', { pattern: 'failed' }, 'g2'),
        use('Bash', { pattern: 'x', file_path: '/r/x.ts' }, 'b1'),
        use('Read', null, 'r4'),
        done('r1', true),
        done('r3'),
        done('g1'),
        done('g2', true),
        done('b1'),
        done('r4'),
        { type: 'result', structured_output: { findings: [] } },
      ),
      'Run',
    )
    expect(run.reads).toEqual([])
    expect(run.searches).toEqual([])
  })

  it('counts a subagent call like any other', () => {
    const run = readStream(
      stream(
        use('Read', { file_path: '/r/sub.ts' }, 'r1', { parent_tool_use_id: 'agent-1' }),
        done('r1'),
        { type: 'result', structured_output: { findings: [] } },
      ),
      'Run',
    )
    expect(run.reads).toEqual(['/r/sub.ts'])
  })
})
