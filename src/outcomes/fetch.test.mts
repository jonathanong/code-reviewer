import { describe, expect, it } from 'vitest'

import { fetchPull } from './fetch.mts'
import { readReactions } from './reactions.mts'

const answer = (pull: object) => JSON.stringify({ data: { repository: { pullRequest: pull } } })

describe('fetchPull', () => {
  it('fills defaults for fields GitHub left out', async () => {
    const thread = { comments: { nodes: [{ pullRequestReview: { databaseId: 100 } }] } }
    const run = async (args: string[]) =>
      args.some((arg) => arg.includes('reviewThreads('))
        ? answer({ reviewThreads: { nodes: [thread] } })
        : answer({ reviews: { nodes: [{}] } })
    const pull = await fetchPull(run, 'acme/widgets', 7)
    expect(pull).toMatchObject({ state: 'OPEN', head: '', truncated: false })
    expect(pull.reviews).toEqual([
      {
        id: 0,
        state: '',
        body: '',
        url: null,
        author: null,
        reactions: { up: 0, down: 0, other: {} },
      },
    ])
    expect(pull.threads[0]).toMatchObject({
      resolved: false,
      outdated: false,
      comments: [
        { id: 0, body: '', path: null, startLine: null, endLine: null, oid: null, reviewId: 100 },
      ],
    })
  })

  it('reads nothing from an answer with no pull request', async () => {
    const pull = await fetchPull(async () => '{}', 'acme/widgets', 7)
    expect(pull).toMatchObject({ reviews: [], threads: [], truncated: false })
  })
})

describe('readReactions', () => {
  it('sums thumbs and keeps other reactions raw, skipping empty or malformed groups', () => {
    expect(
      readReactions([
        { content: 'THUMBS_UP', reactors: { totalCount: 2 } },
        { content: 'THUMBS_DOWN', reactors: { totalCount: 1 } },
        { content: 'HEART', reactors: { totalCount: 4 } },
        { content: 'HEART', reactors: { totalCount: 1 } },
        { content: 'EYES', reactors: { totalCount: 0 } },
        {},
        null,
      ]),
    ).toEqual({ up: 2, down: 1, other: { HEART: 5 } })
    expect(readReactions(undefined)).toEqual({ up: 0, down: 0, other: {} })
  })
})
