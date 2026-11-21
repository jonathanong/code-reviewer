import { parseReferences } from './reference-parse.mts'
import type { ContextDeps, ContextInput, ContextSection, SectionBuilder } from './types.mts'

/** Referenced commits described at most; the rest are named only. */
export const MAX_REFERENCES = 6
/** Commit messages of the pull request read at most. */
export const MAX_MESSAGES = 100
/** Files of a referenced commit listed. */
export const MAX_COMMIT_FILES = 10
/** Shared files named. */
export const MAX_SHARED_FILES = 5
const TIMEOUT_MS = 30_000
const FORMAT = '--format=%H%x1f%h%x1f%cs%x1f%s'

type Ref = { label: string; sha: string }
type Commit = { full: string; short: string; date: string; subject: string; files: string[] }

const reason = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0] as string

/** The first commit on the base branch whose subject is exactly `subject`. */
async function bySubject(git: Git, input: ContextInput, subject: string): Promise<string | null> {
  const out = await git([
    'log',
    '-n',
    '20',
    '--fixed-strings',
    `--grep=${subject}`,
    '--format=%H%x1f%s',
    input.baseSha,
  ])
  const line = out.split('\n').find((l) => l.split('\u001f')[1] === subject)
  return line === undefined ? null : (line.split('\u001f')[0] as string)
}

type Git = (args: string[]) => Promise<string>

/** The first commit on the base branch whose message ends a line with `(#N)`. */
async function byNumber(git: Git, input: ContextInput, number: number): Promise<string | null> {
  const out = await git(['log', '-n', '1', '--format=%H', `--grep=(#${number})$`, input.baseSha])
  return out.trim() === '' ? null : out.trim()
}

async function describe(git: Git, sha: string): Promise<Commit | null> {
  try {
    await git(['cat-file', '-e', `${sha}^{commit}`])
  } catch {
    return null
  }
  const out = await git(['show', '--no-color', '--no-renames', '--name-only', FORMAT, sha])
  const [first = '', ...rest] = out.split('\n')
  const [full = sha, short = sha, date = '', subject = ''] = first.split('\u001f')
  return { full, short, date, subject, files: rest.filter((line) => line.trim() !== '') }
}

function lines(commit: Commit, label: string, mine: ReadonlySet<string>): string[] {
  const shared = commit.files.filter((file) => mine.has(file))
  const shown = commit.files.slice(0, MAX_COMMIT_FILES).join(', ')
  const more = commit.files.length - MAX_COMMIT_FILES
  const overlap =
    shared.length === 0
      ? 'touches none of the files this pull request changes'
      : `touches ${shared.length} file(s) this pull request also changes: ${shared.slice(0, MAX_SHARED_FILES).join(', ')}${shared.length > MAX_SHARED_FILES ? ', ...' : ''}`
  return [
    `### \`${commit.short}\` ${commit.date} ${commit.subject.slice(0, 100)}`,
    `Referenced as ${label}; ${overlap}.`,
    `Files: ${shown === '' ? 'none' : shown}${more > 0 ? `, and ${more} more` : ''}`,
  ]
}

/** What the pull request's commit messages say it fixes or reverts, found in local history. */
export const linkedRegressions: SectionBuilder = {
  name: 'linked-regressions',
  async build(input, deps: ContextDeps): Promise<ContextSection | null> {
    const git: Git = (args) =>
      deps.exec('git', ['-C', input.tree, ...args], { timeoutMs: TIMEOUT_MS })
    const log = await git([
      'log',
      '-n',
      String(MAX_MESSAGES),
      '--format=%B%x1e',
      `${input.baseSha}..${input.headSha}`,
    ])
    const found = parseReferences(log.split('\u001e'))
    const refs: Ref[] = found.shas.map((sha) => ({ label: `\`${sha}\``, sha }))
    const unresolved: string[] = []
    const tried = [
      ...found.subjects.map((s) => ({
        label: `revert of "${s}"`,
        find: () => bySubject(git, input, s),
      })),
      ...found.numbers.map((n) => ({ label: `#${n}`, find: () => byNumber(git, input, n) })),
    ]
    for (const item of tried) {
      try {
        const sha = await item.find()
        if (sha === null) unresolved.push(item.label)
        else refs.push({ label: item.label, sha })
      } catch (error) {
        unresolved.push(`${item.label} (${reason(error)})`)
      }
    }
    if (refs.length === 0 && unresolved.length === 0) return null
    const mine = new Set(
      (
        await git([
          'diff',
          '--name-only',
          '--no-renames',
          `${input.baseSha}...${input.headSha}`,
        ]).catch(() => '')
      )
        .split('\n')
        .filter((line) => line !== ''),
    )
    const body: string[] = []
    const seen = new Set<string>()
    for (const ref of refs.slice(0, MAX_REFERENCES)) {
      try {
        const commit = await describe(git, ref.sha)
        if (commit === null) unresolved.push(ref.label)
        else if (!seen.has(commit.full)) {
          seen.add(commit.full)
          body.push(lines(commit, ref.label, mine).join('\n'))
        }
      } catch (error) {
        unresolved.push(`${ref.label} (${reason(error)})`)
      }
    }
    if (refs.length > MAX_REFERENCES)
      body.push(`${refs.length - MAX_REFERENCES} more reference(s) not described.`)
    if (unresolved.length > 0) {
      body.push(`Not found in local history: ${unresolved.join('; ')}.`)
    }
    return { title: 'Linked regressions', body: body.join('\n\n') }
  },
}
