import type { RunTextCommand } from '../gh-cli/index.mts'

/** Logins whose `final-review` markers count; compared case-insensitively. */
export type TrustedAuthors = ReadonlySet<string>

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
 * The identity that posts reviews, and nobody else: the authenticated viewer, or under App auth
 * the App's own `<slug>[bot]`. An installation token cannot query `viewer`; when neither lookup
 * succeeds nothing is trusted, and every other author's reviews are read as ordinary context.
 */
export async function resolveTrustedAuthors(
  run: RunTextCommand,
  identity: () => Promise<string | undefined>,
): Promise<TrustedAuthors> {
  const trusted = new Set<string>()
  try {
    const out = await run(['api', 'graphql', '-f', 'query={ viewer { login } }'])
    const login = (JSON.parse(out) as { data?: { viewer?: { login?: string } } }).data?.viewer
      ?.login
    if (login !== undefined) trusted.add(login.toLowerCase())
  } catch {
    // No viewer under an installation token; the App identity below covers it.
  }
  try {
    const login = await identity()
    if (login !== undefined) trusted.add(login.toLowerCase())
  } catch {
    // A failed lookup trusts no one rather than failing the command.
  }
  return trusted
}
