/** `https://github.com/<owner>/<repo>`. */
export const REPO_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/u
export const OWNER_REPO_RE = /^[\w.-]+\/[\w.-]+$/u
/** A ref a skill link may be read at. */
export const REF_RE = /^[\w][\w./-]*$/u
/** A plugin directory inside its repository, never leaving it. */
export const DIR_RE = /^[\w.-]+(?:\/[\w.-]+)*$/u

const SKILL_URL_RE = new RegExp(
  `^(https://github\\.com/[\\w.-]+/[\\w.-]+)/blob/(${REF_RE.source.slice(1, -1)})/(?:(${DIR_RE.source.slice(1, -1)})/)?skills/[\\w.-]+/SKILL\\.md$`,
  'u',
)

/**
 * Whether `url` has exactly the shape `skillUrl` builds:
 * `<repository>/blob/<ref>/[<plugin dir>/]skills/<skill>/SKILL.md`, none of it leaving the repository.
 */
export function isSkillUrl(url: string): boolean {
  const match = SKILL_URL_RE.exec(url)
  return match !== null && !url.split('/').includes('..')
}
