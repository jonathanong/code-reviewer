import type { RunTextCommand } from '../gh-cli/index.mts'

type Lookup = {
  run: RunTextCommand
  repo: string
  appLogin?: () => Promise<string | undefined>
}

/**
 * The newest check run of this name at `sha` that this App wrote, so a later process (`post` after
 * a held `run`) completes the run `claim` opened instead of adding a second one. A failed lookup
 * is the same as none: a new run is better than losing the verdict.
 */
export async function findCheckRun(
  input: Lookup,
  name: string,
  sha: string,
): Promise<number | undefined> {
  try {
    const login = await input.appLogin?.()
    const slug = login?.replace(/\[bot\]$/u, '')
    const out = await input.run([
      'api',
      `repos/${input.repo}/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}&per_page=100`,
      '-q',
      '.check_runs[] | "\\(.id) \\(.app.slug)"',
    ])
    const ids = out.split('\n').flatMap((line) => {
      const [, id, appSlug] = /^(\d+) (\S*)$/u.exec(line.trim()) ?? []
      return id !== undefined && (slug === undefined || appSlug === slug) ? [Number(id)] : []
    })
    return ids.length === 0 ? undefined : Math.max(...ids)
  } catch {
    return undefined
  }
}
