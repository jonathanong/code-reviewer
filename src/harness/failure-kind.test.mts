import { describe, expect, it } from 'vitest'

import { ExecError } from '../review/benchmark/exec.mts'
import { harnessFailureKind } from './failure-kind.mts'
import { HarnessRefusal } from './refusal.mts'

const OTHER = { kind: 'other' } as const
const exec = (message: string, stdout = '', cause?: unknown) =>
  new ExecError(message, 1, stdout, cause)
const answered = JSON.stringify({ type: 'result', is_error: true, subtype: 'error_max_turns' })

describe('harnessFailureKind', () => {
  it('names a rate limit or overload that outlived the retry budget', () => {
    expect(harnessFailureKind(exec('x'), { kind: 'rate_limited' })).toBe('rate_limited')
    expect(harnessFailureKind(exec('x'), { kind: 'overloaded' })).toBe('overloaded')
  })

  it('names a killed run a timeout, even without output', () => {
    expect(harnessFailureKind(exec('claude exited with null', '', { killed: true }), OTHER)).toBe(
      'timeout',
    )
  })

  it('names a rejected flag from the stderr tail', () => {
    expect(
      harnessFailureKind(exec("claude exited with 1\nerror: unknown option '--x'"), OTHER),
    ).toBe('unsupported_flag')
  })

  it('names a non-zero exit with no result event a crash', () => {
    expect(harnessFailureKind(exec('claude exited with 1'), OTHER)).toBe('crash')
  })

  it('names a failure that is not an exec failure unparseable', () => {
    expect(harnessFailureKind(new SyntaxError('Unexpected token'), OTHER)).toBe('unparseable')
  })

  it.each([
    ['credentials', exec('x'), { kind: 'auth' } as const],
    ['a capability refusal', new HarnessRefusal('no'), OTHER],
    ['a run that answered with an error result', exec('x', answered), OTHER],
  ])('names nothing for %s', (_name, error, failure) => {
    expect(harnessFailureKind(error, failure)).toBeUndefined()
  })
})
