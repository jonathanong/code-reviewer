import type { RunTextCommand } from '../gh-cli/index.mts'

/** Logins whose `final-review` markers count; compared case-insensitively. */
export type TrustedAuthors = ReadonlySet<string>

/** Parses the comma-separated `FINAL_REVIEWER_TRUSTED_AUTHORS` allowlist. */
export function parseTrustedAuthors(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((login) => login.trim())
    .filter((login) => login.length > 0)
}

/**
 * REST reports an App as `<slug>[bot]` while GraphQL reports the bare `<slug>`, so logins are
 * compared case-insensitively with a trailing `[bot]` stripped from both sides.
 */
function normalizeLogin(login: string): string {
  return login.toLowerCase().replace(/\[bot\]$/u, '')
}

export function isTrustedAuthor(
  login: string | null | undefined,
  trusted: TrustedAuthors,
): boolean {
  if (login === null || login === undefined) return false
  const wanted = normalizeLogin(login)
  return [...trusted].some((entry) => normalizeLogin(entry) === wanted)
}

/**
 * The identity that posts final reviews: the authenticated viewer plus the allowlist. An App
 * installation token cannot query `viewer`, so under App auth the allowlist (the App's
 * `<slug>[bot]` login) is the only source; with neither, no marker is trusted.
 */
export async function resolveTrustedAuthors(
  run: RunTextCommand,
  allowlist: readonly string[],
): Promise<TrustedAuthors> {
  const trusted = new Set(allowlist.map((login) => login.toLowerCase()))
  try {
    const out = await run(['api', 'graphql', '-f', 'query={ viewer { login } }'])
    const login = (JSON.parse(out) as { data?: { viewer?: { login?: string } } }).data?.viewer
      ?.login
    if (login !== undefined) trusted.add(login.toLowerCase())
  } catch {
    // No viewer under an installation token; rely on the allowlist.
  }
  return trusted
}
