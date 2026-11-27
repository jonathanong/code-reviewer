import { lintFile, type Config } from './lint.mts'

/** Lints every file, then reports each allow entry that no file needed as its own problem. */
export function audit(files: Record<string, string>, config: Config): string[] {
  const used = new Set<string>()
  const problems = Object.entries(files).flatMap(([path, source]) =>
    lintFile(path, source, config, used),
  )
  const unused = config.allow.filter((entry) => !used.has(entry))
  return [...problems, ...unused.map((entry) => `unused allow entry: ${entry}`)]
}

/** The process exit code: 0 when the audit has no problem, 1 otherwise. */
export function exitCode(files: Record<string, string>, config: Config): number {
  return audit(files, config).length === 0 ? 0 : 1
}
