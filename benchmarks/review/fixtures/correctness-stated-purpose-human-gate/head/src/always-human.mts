import type { Policy, Rule } from './policy.mts'

export const PROTECTED = ['deploy/', 'secrets/']

/** A rule sends its paths to a person when a human seat is listed or Claude is not the only reviewer. */
function sendsToPerson(rule: Rule): boolean {
  return rule.seats.length > 0 || rule.claude !== 'approve'
}

export function checkAlwaysHuman(policy: Policy): void {
  for (const path of PROTECTED) {
    const rules = policy.rules.filter((r) => r.paths.some((p) => path.startsWith(p)))
    if (rules.length === 0) throw new Error(`no rule covers ${path}`)
    if (!rules.every(sendsToPerson)) throw new Error(`${path} can skip human review`)
  }
}
