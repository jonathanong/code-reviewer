import { otherHarness } from './harness-option.mts'

// A prefix is a command name and subcommand, so anything a shell would treat as syntax is refused.
const SHELL_SYNTAX = /[;|&<>`\n]|\$\(/

/**
 * Checks `bench --shell` before any work and returns the prefixes to grant, without duplicates.
 * The experiment is Claude only: Codex refuses shell prefixes, so a non-Claude `--harness` is
 * rejected here, naming the flag.
 */
export function shellPrefixes(values: {
  shell?: string[]
  harness?: string
  'loads-only'?: boolean
}): string[] {
  const given = values.shell
  if (given === undefined) return []
  if (values['loads-only'] === true)
    throw new Error(
      'bench --shell cannot be used with --loads-only: its report has no shell label.',
    )
  const harness = otherHarness(values.harness)
  if (harness !== undefined)
    throw new Error(
      `bench --shell needs --harness claude: the ${harness} harness refuses shell prefixes.`,
    )
  const prefixes = given.map((prefix) => prefix.trim())
  for (const prefix of prefixes) {
    if (prefix === '') throw new Error('bench --shell needs a command prefix, such as "git log".')
    if (SHELL_SYNTAX.test(prefix))
      throw new Error(
        `bench --shell "${prefix}": a prefix is a command name and subcommand, without shell syntax (; | & < > backtick $( or a newline).`,
      )
  }
  return [...new Set(prefixes)]
}

/**
 * The prefixes to label a run with: the flag, else what the saved results record, for
 * `--score-only`. Saved results that do not all record the same grant are not one arm, so they
 * are refused.
 */
export function grantedShell(
  flag: readonly string[] | undefined,
  saved: ReadonlyArray<readonly string[] | null>,
): string[] | undefined {
  if (flag !== undefined) return flag.length === 0 ? undefined : [...flag]
  const grants = new Set(saved.map((prefixes) => (prefixes ?? []).join('\n')))
  if (grants.size > 1)
    throw new Error(
      'bench: the saved results were run with different --shell grants, so they are not one arm. Score them in separate --out directories.',
    )
  const found = saved[0] ?? []
  return found.length === 0 ? undefined : [...found]
}

/** The summary.md line that stops an experiment row passing for a normal one. */
export function shellNote(prefixes: readonly string[]): string {
  return `Shell granted to the pillar agent: ${prefixes.join(', ')}. This is an experiment, not what a review grants, so these rows are not comparable with normal rows.`
}
