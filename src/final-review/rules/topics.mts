type Topic = { match: RegExp; skills: string[] }

const TEST = /(?:\.(?:test|spec)\.[^/]+$|(?:^|\/)(?:__tests__|tests?)\/)/u
const JS = /\.(?:ts|mts|cts|tsx|js|mjs|cjs)$/u

const TOPICS: Topic[] = [
  { match: TEST, skills: ['testing-rules', 'test-authoring'] },
  { match: /(?:playwright|e2e)/iu, skills: ['playwright-rules', 'playwright-authoring'] },
  {
    match: /(?:\.sql$|(?:^|\/)(?:migrations?|db)\/|repositor|data-access|dao\b)/iu,
    skills: ['postgresql-rules', 'postgres-schema-design', 'bounded-iteration'],
  },
  {
    match: /(?:queue|job|worker|cron|schedul)/iu,
    skills: ['queue-rules', 'glide-mq', 'bounded-iteration'],
  },
  { match: JS, skills: ['typescript-rules'] },
  { match: /(?:\.(?:tsx|jsx)$|next\.config)/u, skills: ['react-rules'] },
  { match: /(?:\.rs$|(?:^|\/)Cargo\.toml$)/u, skills: ['rust-rules'] },
  {
    match: /(?:^|\/)(?:\.github\/workflows\/|action\.ya?ml$)/u,
    skills: ['github-actions-rules', 'github-actions-checklist', 'github-actions-authoring'],
  },
  {
    match: /(?:^|\/)(?:\.github\/|(?:vitest|jest|playwright)\.[^/]*config|vitest\.workspace)/u,
    skills: ['review-ci-logs'],
  },
  {
    match: /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock)$/u,
    skills: ['dependency-rules', 'package-json-checklist'],
  },
  { match: /(?:^|\/)dependabot\.ya?ml$/u, skills: ['dependabot', 'dependency-rules'] },
  {
    match: /(?:(?:^|\/)Dockerfile|\.tf$|\.sh$|terraform|(?:^|\/)infra\/)/iu,
    skills: ['infra-rules'],
  },
  { match: /(?:webhook|integration)/iu, skills: ['integrations-rules'] },
  { match: /(?:flag|rollout|migration)/iu, skills: ['rollout-rules'] },
  { match: /(?:log|metric|alert)/iu, skills: ['observability-rules'] },
  { match: /\.(?:swift|cs)$/u, skills: ['native-app-rules'] },
  { match: /(?:auth|session|token|crypto)/iu, skills: ['security-rules'] },
]

const ALWAYS = ['git-rules', 'agent-workflow']

/** Skill names worth reading for the changed paths, each with the first path that suggested it. */
export function suggestSkills(paths: readonly string[]): Map<string, string> {
  const found = new Map<string, string>()
  const add = (skill: string, path: string) => {
    if (!found.has(skill)) found.set(skill, path)
  }
  for (const path of paths) {
    for (const topic of TOPICS) {
      if (topic.match.test(path)) topic.skills.forEach((skill) => add(skill, path))
    }
    if (TEST.test(path) && JS.test(path)) add('vitest-test-authoring', path)
  }
  const first = paths[0] ?? ''
  ALWAYS.forEach((skill) => add(skill, first))
  return found
}
