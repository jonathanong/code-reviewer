/** One open pull request of the repository, as stack detection sees it. */
export type StackMember = {
  number: number
  title: string
  headRef: string
  baseRef: string
  headSha: string
}

/** A pull request's place among the open pull requests that build on each other. */
export type StackWalk = {
  /** Bottom-up: the members below the pull request, the pull request, the members above it. */
  members: StackMember[]
  /** Position of the pull request in `members`. */
  index: number
  /** The base branch of the bottom member. */
  rootBase: string
}

export type Stack = StackWalk & {
  rootIsDefault: boolean
  /** The pull request stands alone and its base is not the default branch. */
  staleBase: boolean
}

/** The short form `plan.json` carries. */
export type StackSummary = {
  members: number[]
  index: number
  rootBase: string
  rootIsDefault: boolean
  staleBase: boolean
}

const MAX_HOPS = 10
const MAX_ABOVE = 20

/**
 * Walks from `pr` down through the open pull requests whose head branch is its base, and up
 * through those whose base is its head branch. Branch names guard against cycles; each direction
 * stops after `MAX_HOPS`, and the members above are capped so a wide fan-out stays small.
 * Returns undefined when `pr` is not among `pulls`.
 */
export function walkStack(pr: number, pulls: readonly StackMember[]): StackWalk | undefined {
  const sorted = [...pulls].sort((left, right) => left.number - right.number)
  const self = sorted.find((pull) => pull.number === pr)
  if (self === undefined) return undefined
  const byHead = new Map<string, StackMember>()
  for (const pull of sorted) if (!byHead.has(pull.headRef)) byHead.set(pull.headRef, pull)
  const visited = new Set([self.headRef])
  const below: StackMember[] = []
  let rootBase = self.baseRef
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const parent = byHead.get(rootBase)
    if (parent === undefined || visited.has(parent.headRef)) break
    visited.add(parent.headRef)
    below.unshift(parent)
    rootBase = parent.baseRef
  }
  const above: StackMember[] = []
  const climb = (from: StackMember, depth: number): void => {
    if (depth >= MAX_HOPS) return
    for (const child of sorted) {
      if (above.length >= MAX_ABOVE) return
      if (child.baseRef !== from.headRef || visited.has(child.headRef)) continue
      visited.add(child.headRef)
      above.push(child)
      climb(child, depth + 1)
    }
  }
  climb(self, 0)
  return { members: [...below, self, ...above], index: below.length, rootBase }
}

/**
 * The stack `pr` belongs to, or undefined for a flat pull request: its base is the default
 * branch and no open pull request builds on it.
 */
export function detectStack(
  pr: number,
  pulls: readonly StackMember[],
  defaultBranch: string,
): Stack | undefined {
  const walk = walkStack(pr, pulls)
  if (walk === undefined) return undefined
  const rootIsDefault = walk.rootBase === defaultBranch
  const alone = walk.members.length === 1
  if (alone && rootIsDefault) return undefined
  return { ...walk, rootIsDefault, staleBase: alone }
}

export function summarizeStack(stack: Stack): StackSummary {
  return {
    members: stack.members.map((member) => member.number),
    index: stack.index,
    rootBase: stack.rootBase,
    rootIsDefault: stack.rootIsDefault,
    staleBase: stack.staleBase,
  }
}
