import type { RunTextCommand } from '../gh-cli/index.mts'

const THREAD_ID_RE = /^[A-Za-z0-9_=-]+$/u

const MUTATION = `mutation($id: ID!) {
  resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } }
}`

/** Resolves the review threads of findings a follow-up found fixed. */
export async function resolveThreads(
  run: RunTextCommand,
  ids: readonly string[],
): Promise<string[]> {
  for (const id of ids) if (!THREAD_ID_RE.test(id)) throw new Error(`Invalid thread id: ${id}`)
  const resolved: string[] = []
  for (const id of ids) {
    await run(['api', 'graphql', '-f', `query=${MUTATION}`, '-f', `id=${id}`, '--silent'])
    resolved.push(id)
  }
  return resolved
}
