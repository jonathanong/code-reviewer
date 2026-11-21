import type { TargetConfig } from '../review/rules/target-config.mts'
import type { ReviewDeps } from './deps.mts'

type ConfigSource = Pick<ReviewDeps, 'configs' | 'targetConfig'>

/** Config problems that name this repository's or its owner's machine files, in lowercase compare. */
function machineProblems(deps: ConfigSource, repo: string): string[] {
  const lower = repo.toLowerCase()
  const owner = lower.split('/')[0] as string
  return deps.configs().problems.filter((problem) => {
    const text = problem.toLowerCase()
    return text.startsWith(`${owner}.`) || text.startsWith(`${lower}.`)
  })
}

/**
 * The one check every command that starts a review or acts on its labels runs before any work: a
 * problem in the machine files of this repository or its owner, or in the repository's own file
 * on its default branch, stops the command. Returns that file's parsed config for the caller.
 */
export async function requireValidConfig(deps: ConfigSource, repo: string): Promise<TargetConfig> {
  const target = await deps.targetConfig(repo)
  const problems = [...machineProblems(deps, repo), ...target.problems]
  if (problems.length > 0) throw new Error(`settings invalid: ${problems.join('; ')}`)
  return target
}
