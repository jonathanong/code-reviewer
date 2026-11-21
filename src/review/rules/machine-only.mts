/**
 * A key that decides what the reviewer runs, fetches, picks or posts unattended, so only machine
 * files may set it: in the reviewed repository's own file (`target`) it is ignored with a
 * problem; anywhere else it is parsed.
 */
export function machineOnly<T>(
  scope: 'repo' | 'owner' | 'target',
  raw: unknown,
  file: string,
  key: string,
  problems: string[],
  options: {
    /** Fills "<file>: <what> machine-only; ignored". */
    what: string
    parse: (raw: unknown, where: string, problems: string[]) => T | undefined
  },
): T | undefined {
  if (scope !== 'target') return options.parse(raw, `${file} ${key}`, problems)
  if (raw !== undefined) problems.push(`${file}: ${options.what} machine-only; ignored`)
  return undefined
}
