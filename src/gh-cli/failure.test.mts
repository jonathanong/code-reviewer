import { describe, expect, it } from 'vitest'

import { classifyFailure, RETRY_AFTER_CAP_MS } from './failure.mts'

function ghError(message: string, stderr?: string): Error {
  return Object.assign(new Error(message), stderr === undefined ? {} : { stderr })
}

describe('classifyFailure', () => {
  it.each([500, 502, 503, 504])('treats HTTP %i as transient', (status) => {
    const error = ghError(`gh: HTTP ${status}: Bad Gateway (https://api.github.com/x)`)
    expect(classifyFailure(error)).toEqual({ kind: 'transient', reason: `HTTP ${status}` })
  })

  it.each([400, 401, 403, 404, 422, 501])('treats HTTP %i as permanent', (status) => {
    expect(classifyFailure(ghError(`gh: Something (HTTP ${status})`)).kind).toBe('permanent')
  })

  it.each([
    'read tcp 1.2.3.4:5: connection reset by peer',
    'Get "https://api.github.com": net/http: TLS handshake timeout',
    'dial tcp: i/o timeout',
    'connect ETIMEDOUT 140.82.0.1:443',
    'read ECONNRESET',
    'Post "x": context deadline exceeded (Client.Timeout exceeded)',
    'unexpected EOF',
    'unexpected end of JSON input',
  ])('treats a network failure as transient: %s', (stderr) => {
    expect(classifyFailure(ghError('Command failed: gh api x', stderr))).toEqual({
      kind: 'transient',
      reason: 'network failure',
    })
  })

  it('reads a secondary rate limit as transient and carries a named wait', () => {
    const stderr = 'HTTP 403: You have exceeded a secondary rate limit. retry-after: 12'
    expect(classifyFailure(ghError('Command failed', stderr))).toEqual({
      kind: 'transient',
      reason: 'rate limited (HTTP 403)',
      retryAfterMs: 12_000,
    })
  })

  it('retries a 429 without a named wait, on the backoff schedule', () => {
    expect(classifyFailure(ghError('HTTP 429: Too Many Requests'))).toEqual({
      kind: 'transient',
      reason: 'rate limited (HTTP 429)',
    })
  })

  it('does not wait past the cap', () => {
    const wait = RETRY_AFTER_CAP_MS / 1000 + 1
    const failure = classifyFailure(ghError(`HTTP 429: slow down. Retry-After: ${wait}`))
    expect(failure.kind).toBe('permanent')
  })

  it('treats a primary 403 and validation errors as permanent', () => {
    expect(classifyFailure(ghError('HTTP 403: API rate limit exceeded')).kind).toBe('permanent')
    expect(classifyFailure(ghError('HTTP 422: Validation Failed')).kind).toBe('permanent')
  })

  it('treats an unnamed failure, such as a missing gh binary, as permanent', () => {
    expect(classifyFailure(ghError('spawn gh ENOENT')).kind).toBe('permanent')
    expect(classifyFailure('plain string').kind).toBe('permanent')
  })

  it('reads a thrown non-Error value', () => {
    expect(classifyFailure('HTTP 503: unavailable').kind).toBe('transient')
  })
})
