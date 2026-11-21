import { describe, expect, it } from 'vitest'

import { ExecError } from '../review/benchmark/exec.mts'
import { classifyFailure } from './claude-classify.mts'

const failed = (event: Record<string, unknown> | null) =>
  new ExecError('claude exited with 1', 1, event === null ? '' : JSON.stringify(event), undefined)

const error = (status: number) => ({ type: 'result', is_error: true, api_error_status: status })

describe('classifyFailure for claude', () => {
  it('reads the API status of an error result', () => {
    expect(classifyFailure(failed(error(429)))).toEqual({ kind: 'rate_limited' })
    expect(classifyFailure(failed(error(529)))).toEqual({ kind: 'overloaded' })
    expect(classifyFailure(failed(error(401)))).toEqual({ kind: 'auth' })
  })

  it('reads the status from the result text when no status field is present', () => {
    const text = (result: string) => failed({ type: 'result', is_error: true, result })
    expect(classifyFailure(text('API Error: 429 {"type":"rate_limit_error"}'))).toEqual({
      kind: 'rate_limited',
    })
    expect(classifyFailure(text('API Error 529 overloaded'))).toEqual({ kind: 'overloaded' })
  })

  it.each([
    ['another status', failed(error(500))],
    ['a result that is not an error', failed({ type: 'result', api_error_status: 429 })],
    ['an error result without a status', failed({ type: 'result', is_error: true, result: 'no' })],
    ['an error result with a non-text result', failed({ type: 'result', is_error: true })],
    ['a failure that printed no result', failed(null)],
    ['an error that is not an exec failure', new Error('429 rate limit')],
  ])('leaves %s as other', (_name, thrown) => {
    expect(classifyFailure(thrown)).toEqual({ kind: 'other' })
  })
})
