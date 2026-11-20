import { describe, expect, it } from 'vitest'

import { callKind, isDelete } from './retry-safety.mts'

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
  ])('treats %j as an idempotent write', (args) => {
    expect(callKind(args)).toBe('idempotent-write')
  })

  it.each([
    [['api', '--method', 'POST', 'repos/o/r/pulls/1/reviews', '--input', 'f', '-q', '.html_url']],
    [['api', '--method', 'POST', 'repos/o/r/check-runs', '-f', 'name=x']],
    [['api', 'graphql', '-f', 'query=mutation { resolve }']],
    [['api', 'repos/o/r/things', '-f', 'a=b']],
    [['pr', 'edit', '1']],
    [['pr']],
    [['repo', 'clone', 'o/r']],
    [['api']],
  ])('treats %j as a write', (args) => {
    expect(callKind(args)).toBe('write')
  })
})

describe('isDelete', () => {
  it('finds a DELETE method in either spelling', () => {
    expect(isDelete(['api', '--method', 'DELETE', 'x'])).toBe(true)
    expect(isDelete(['api', '-X', 'delete', 'x'])).toBe(true)
    expect(isDelete(['api', '--method', 'POST', 'x'])).toBe(false)
    expect(isDelete(['api', 'x'])).toBe(false)
  })
})
