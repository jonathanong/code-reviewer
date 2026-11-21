import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { PrConversation } from '../context-query.mts'
import { FIRST_COMMENT_CHARS, describeOthers, otherReviewers } from './other-reviewers.mts'
import { SEVERITY_MARKERS, statedSeverity } from './severity-markers.mts'
import type { ContextDeps, ContextInput } from './types.mts'

const fixture = (name: string): PrConversation =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/conversation/${name}.json`, import.meta.url), 'utf8'),
  ) as PrConversation

const input: ContextInput = {
  repo: 'acme/widgets',
  pr: 7,
  tree: '/tree',
  baseSha: 'b',
  headSha: 'h',
  out: '/out',
  skills: [],
}

const deps = (pull: PrConversation, own: string[], calls: string[][] = []): ContextDeps => ({
  exec: async () => '',
  readFile: async () => '',
  stateDir: '/state',
  trusted: async () => new Set(own),
  gh: async (args) => {
    calls.push(args)
    return JSON.stringify({ data: { repository: { pullRequest: pull } } })
  },
})

describe('otherReviewers', () => {
  it('lists unresolved threads of others by stated severity, with links and no own threads', async () => {
    const calls: string[][] = []
    const section = await otherReviewers.build(
      input,
      deps(fixture('threads'), ['reviewer-app'], calls),
    )
    const body = section?.body ?? ''
    expect(calls[0]).toContain('owner=acme')
    expect(body.indexOf('src/b.ts')).toBeLessThan(body.indexOf('src/a.ts'))
    expect(body.indexOf('src/a.ts')).toBeLessThan(body.indexOf('src/c.ts'))
    expect(body).toContain('- codex[bot], `src/b.ts`, https://example.test/c/2')
    expect(body).toContain('severity: P0 (Codex; blocking tier); outdated')
    expect(body).toContain('severity: Major (CodeRabbit; high tier)')
    expect(body).toContain('- unknown author, `src/c.ts:9`, no link\n  severity: unstated')
    expect(body).toContain('  > Why this name?\n  >\n  > Please explain.')
    expect(body).not.toContain('src/d.ts')
    expect(body).not.toContain('my own')
    expect(body).not.toContain('src/f.ts')
    expect(body).toContain('older ones may be missing')
  })

  it('lists a change request only while it stands, and not the reviewer own', async () => {
    const body = (await otherReviewers.build(input, deps(fixture('threads'), ['reviewer-app'])))
      ?.body as string
    expect(body).toContain('- alice, https://example.test/r/1, changes requested\n  > Please split')
    expect(body).not.toContain('bob')
    expect(body).not.toContain('mine')
    expect(body).not.toContain('ghost')
    expect(body).not.toContain('carol')
  })

  it('lists a change request with no text and no link', () => {
    const pull = fixture('quiet')
    pull.reviews.nodes.push({
      id: 'R',
      author: { login: 'erin' },
      state: 'CHANGES_REQUESTED',
      body: '',
      submittedAt: null,
      commit: null,
    })
    expect(describeOthers(pull, new Set(['x']))?.body).toContain(
      '- erin, no link, changes requested',
    )
  })

  it('quotes only the first 400 characters and says so', () => {
    const pull = fixture('threads')
    const first = pull.reviewThreads.nodes[2]?.comments.nodes[0]
    if (first !== undefined) first.body = 'x'.repeat(FIRST_COMMENT_CHARS + 50)
    const body = describeOthers(pull, new Set(['reviewer-app']))?.body ?? ''
    expect(body).toContain(`> ${'x'.repeat(FIRST_COMMENT_CHARS)}\n`)
    expect(body).not.toContain('x'.repeat(FIRST_COMMENT_CHARS + 1))
    expect(body).toContain('[cut at 400 characters]')
  })

  it('keeps thread order within one severity and needs no change requests', () => {
    const pull = fixture('threads')
    pull.reviews.nodes = []
    const [, , third] = pull.reviewThreads.nodes
    if (third !== undefined) pull.reviewThreads.nodes.push({ ...third, id: 'T7', path: 'src/g.ts' })
    const body = describeOthers(pull, new Set(['reviewer-app']))?.body ?? ''
    expect(body).not.toContain('### Changes requested')
    expect(body.indexOf('src/c.ts')).toBeLessThan(body.indexOf('src/g.ts'))
  })

  it('is null when nobody else has anything open', async () => {
    expect(await otherReviewers.build(input, deps(fixture('quiet'), ['reviewer-app']))).toBeNull()
  })

  it('fails the build, which becomes a note, without a gh runner or identity', async () => {
    const { gh: _gh, ...noGh } = deps(fixture('quiet'), ['x'])
    const { trusted: _trusted, ...noTrusted } = deps(fixture('quiet'), ['x'])
    await expect(otherReviewers.build(input, noGh)).rejects.toThrow('no gh')
    await expect(otherReviewers.build(input, noTrusted)).rejects.toThrow('no gh')
  })

  it('fails the build, which becomes a note, when the own identity is unknown or the fetch fails', async () => {
    await expect(otherReviewers.build(input, deps(fixture('quiet'), []))).rejects.toThrow(
      'identity is unknown',
    )
    const failing: ContextDeps = {
      ...deps(fixture('quiet'), ['x']),
      gh: async () => {
        throw new Error('HTTP 502')
      },
    }
    await expect(otherReviewers.build(input, failing)).rejects.toThrow('HTTP 502')
  })
})

describe('statedSeverity', () => {
  it.each([
    ['_⚠️ Potential issue_ | _🔴 Critical_', 'CodeRabbit', 'Critical', 'blocking'],
    ['_🟡 Minor_', 'CodeRabbit', 'Minor', 'medium'],
    ['_🧹 Nitpick_', 'CodeRabbit', 'Nitpick', 'low'],
    ['![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)', 'Codex', 'P2', 'medium'],
    [
      '![high](https://www.gstatic.com/codereviewagent/high-priority.svg)',
      'Gemini Code Assist',
      'high',
      'high',
    ],
    ['### Bug\n\n**High Severity**', 'Cursor Bugbot', 'High', 'high'],
  ])('reads %j', (text, reviewer, label, tier) => {
    expect(statedSeverity(text)).toEqual({ reviewer, label, tier })
  })

  it('reads nothing from prose that merely uses the words', () => {
    expect(statedSeverity('This is a major concern and critical to fix. P1 maybe.')).toBeNull()
  })

  it('has one marker entry per reviewer', () => {
    const names = SEVERITY_MARKERS.map((marker) => marker.reviewer)
    expect(new Set(names).size).toBe(names.length)
  })
})
