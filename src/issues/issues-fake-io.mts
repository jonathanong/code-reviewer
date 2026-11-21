import { noReactions } from '../outcomes/reactions.mts'
import type { Outcome, OutcomeRow } from '../outcomes/types.mts'
import type { IssuesIo } from './file.mts'

export const NOW = new Date('2026-06-10T12:00:00.000Z')

let counter = 0
export function row(outcome: Outcome, over: Partial<OutcomeRow> = {}): OutcomeRow {
  counter += 1
  return {
    repo: 'acme/widgets',
    pr: 7,
    reviewId: 100,
    head: 'b'.repeat(40),
    key: `k${counter}`,
    pillar: null,
    severity: 'high',
    rule: null,
    title: `Finding ${counter}`,
    path: 'src/secret-path.ts',
    url: `https://example.test/c/${counter}`,
    outcome,
    reactions: { finding: noReactions(), review: noReactions() },
    checkedAt: NOW.toISOString(),
    ...over,
  }
}

/** Three disputed findings under one rule: enough for one proposal. */
export const badRule = (rule: string) => Array.from({ length: 3 }, () => row('disputed', { rule }))

export type Call = { repo: string; args: string[] }

/** A fake `gh`: `issue list` answers from `open`, `issue create` from `created`. */
export function fakeIssuesIo(
  options: {
    open?: (repo: string, search: string) => unknown
    create?: (repo: string, args: string[]) => string | Error
  } = {},
) {
  const calls: Call[] = []
  const bodies: string[] = []
  const io: IssuesIo = {
    gh: async (repo, args) => {
      calls.push({ repo, args })
      if (args[1] === 'list') {
        return JSON.stringify(
          options.open?.(repo, args[args.indexOf('--search') + 1] as string) ?? [],
        )
      }
      const made =
        options.create?.(repo, args) ?? `https://example.test/${repo}/issues/${calls.length}`
      if (made instanceof Error) throw made
      return `${made}\n`
    },
    withBodyFile: async (body, use) => {
      bodies.push(body)
      return use('body.md')
    },
  }
  return { io, calls, bodies }
}
