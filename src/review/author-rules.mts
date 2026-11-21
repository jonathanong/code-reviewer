/** `light`: lockfile-only changes are skipped, anything else is light. `skip`: never reviewed. */
export type AuthorReview = 'light' | 'skip'

/** A per-author review rule from `plan.authors`. */
export type AuthorRule = { login: string; review: AuthorReview }

const DEPENDABOT_LOGINS: readonly string[] = ['dependabot[bot]', 'app/dependabot']

/** The rule Dependabot gets unless `plan.authors` names it. */
export const BUILT_IN_RULE: AuthorRule = { login: 'dependabot[bot]', review: 'light' }

/** A login without GitHub's `app/` prefix and `[bot]` suffix, lowercased: the forms of one account compare equal. */
export const accountName = (login: string) =>
  login
    .toLowerCase()
    .replace(/^app\//u, '')
    .replace(/\[bot\]$/u, '')

/** `dependabot` alone is also a possible human login, so it counts only for a bot account. */
export function isDependabot(login: string | null, isBot: boolean): boolean {
  if (login === null) return false
  return DEPENDABOT_LOGINS.includes(login) || (isBot && login === 'dependabot')
}

/** The review rule for a pull request author: a configured rule, else the built-in one for Dependabot. */
export function authorReview(
  login: string | null | undefined,
  isBot: boolean,
  authors: readonly AuthorRule[],
): AuthorReview | undefined {
  if (login === null || login === undefined) return undefined
  const configured = authors.find((rule) => accountName(rule.login) === accountName(login))
  if (configured !== undefined) return configured.review
  return isDependabot(login, isBot) ? BUILT_IN_RULE.review : undefined
}

/** The rules in force: the configured ones, plus the built-in Dependabot rule unless one overrides it. */
export function effectiveAuthorRules(authors: readonly AuthorRule[]): AuthorRule[] {
  const overridden = authors.some((rule) => accountName(rule.login) === accountName('dependabot'))
  return overridden ? [...authors] : [...authors, BUILT_IN_RULE]
}
