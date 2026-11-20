import { describe, expect, it } from 'vitest'

import { callKind, settledByEarlierTry } from './retry-safety.mts'

const SHA = 'a'.repeat(40)

describe('callKind', () => {
  it.each([
    [['pr', 'view', '1', '-R', 'o/r', '--json', 'labels']],
    [['pr', 'diff', '1']],
    [['api', '--paginate', 'repos/o/r/pulls/1/files?per_page=100']],
    [['api', 'repos/o/r/pulls/1', '-q', '.user.login']],
    [['api', '--method', 'GET', 'repos/o/r/pulls/1']],
    [['api', 'repos/o/r/pulls/1', '--method']],
    [['api', 'graphql', '-f', 'query={ viewer { login } }']],
    [['api', 'graphql', '-f', 'query=query { x }', '-F', 'pr=1']],
  ])('treats %j as a read', (args) => {
    expect(callKind(args)).toBe('read')
  })

  it.each([
    [['api', '--method', 'DELETE', 'repos/o/r/issues/1/labels/x', '--silent']],
    [['api', '--method', 'POST', 'repos/o/r/issues/1/labels', '-f', 'labels[]=x']],
    [['api', '--method', 'POST', `repos/o/r/statuses/${SHA}`, '-f', 'state=success']],
    [['api', '--method', 'PUT', 'repos/o/r/pulls/7/reviews/9/dismissals', '-f', 'message=m']],
  ])('treats %j as an idempotent write', (args) => {
    expect(callKind(args)).toBe('idempotent-write')
  })

  it.each([
    [['api', '--method', 'POST', 'repos/o/r/pulls/1/reviews', '--input', 'f', '-q', '.html_url']],
    [['api', '--method', 'POST', 'repos/o/r/check-runs', '-f', 'name=x']],
    [['api', 'graphql', '-f', 'query=mutation { resolve }']],
    [['api', '--method', 'PUT', 'repos/o/r/pulls/7/merge', '-f', 'a=b']],
    [['api', '--method', 'PUT', 'repos/o/r/pulls/7/reviews/9/updates', '-f', 'a=b']],
    [['api', 'repos/o/r/things', '-f', 'a=b']],
    [['pr', 'edit', '1']],
    [['pr']],
    [['repo', 'clone', 'o/r']],
    [['api']],
  ])('treats %j as a write', (args) => {
    expect(callKind(args)).toBe('write')
  })
})

describe('settledByEarlierTry', () => {
  const del = ['api', '--method', 'DELETE', 'repos/o/r/issues/1/labels/x']
  const dismiss = ['api', '--method', 'PUT', 'repos/o/r/pulls/7/reviews/9/dismissals']

  it('accepts a gone target for a DELETE and nothing else', () => {
    expect(settledByEarlierTry(del, 'HTTP 404', '')).toBe(true)
    expect(settledByEarlierTry(del, 'HTTP 422', '')).toBe(false)
  })

  it('accepts an already-dismissed review for a dismissal and nothing else', () => {
    const text = 'HTTP 422: Can not dismiss a dismissed pull request review'
    expect(settledByEarlierTry(dismiss, 'HTTP 422', text)).toBe(true)
    expect(settledByEarlierTry(dismiss, 'HTTP 422', 'HTTP 422: Validation Failed')).toBe(false)
    expect(settledByEarlierTry(dismiss, 'HTTP 404', text)).toBe(false)
  })

  it('accepts nothing for other calls', () => {
    const merge = ['api', '--method', 'PUT', 'repos/o/r/pulls/7/merge']
    expect(settledByEarlierTry(merge, 'HTTP 422', 'already dismissed')).toBe(false)
    expect(settledByEarlierTry(['api', 'x'], 'HTTP 404', '')).toBe(false)
  })
})
