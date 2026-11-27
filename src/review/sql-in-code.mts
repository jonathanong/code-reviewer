import { splitDiff } from './diff-files.mts'
import { isSourcePath } from './triggers.mts'

/**
 * Source files that may carry SQL in a string or template. Markup, config, and docs are left out:
 * a SELECT in a YAML or JSON file is data, and a `.sql` file is already caught by path.
 */
const CODE_RE = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|scala|cs|php|ex|exs|swift)$/u

/**
 * Test support the shared test-path rule misses: `test-helpers/`, `test-cases/`, `foo-tests/`, and
 * a Rust `tests.rs`. SQL there is a fixture, not a query that runs in production.
 */
const SUPPORT_RE = /(?:^|\/)(?:test-[^/]+|[^/]*-tests?)\/|(?:^|\/)tests?\.[a-z]+$/u

/** A tagged template: sql`...`, sql<Row>`...`, Prisma.sql`...`, db.sql`...`. */
const TAG_RE = /\bsql(?:<[^>`]*>)?\s*`/u

/** Kysely builder calls that name a table, which only SQL builders have. */
const BUILDER_RE = /\.(?:selectFrom|insertInto|updateTable|deleteFrom)\s*\(/u

/** Quote or backtick before the match: the text is a string or a template, not code or prose. */
const QUOTED_RE = /["'`]/u

/**
 * A clause that begins a line, in upper case: how SQL is written inside a multi-line template.
 * Case-sensitive on purpose, so prose ("select a file from disk") and identifiers do not match.
 */
const CLAUSE_RE =
  /^\s*(?:SELECT\b(?:\s|$)|(?:LEFT |RIGHT |INNER |FULL |CROSS )?(?:OUTER )?JOIN\s+\S|WHERE\s+\S|GROUP BY\s|ORDER BY\s|HAVING\s|RETURNING\s|ON CONFLICT\b|INSERT INTO\s|DELETE FROM\s|UPDATE\s+\S+\s+SET\b|WITH\s+\S+\s+AS\b|FROM\s+[\w."]+\s*(?:$|\bAS\b|\bWHERE\b|\bJOIN\b))/u

/** A whole statement on one line in a string, in any case. */
const STATEMENT_RE =
  /\bselect\s+(?:\*|distinct\b|[\w."]+(?:\s*,\s*[\w."]+)*\s+from\s+[\w."]+)|\binsert\s+into\s+[\w."]+\s*(?:\(|values\b|select\b)|\bdelete\s+from\s+[\w."]+|\bupdate\s+[\w."]+\s+set\s+[\w."]+\s*=/iu

/** A Postgres interval literal: `interval '1 second'` is not English or code. */
const INTERVAL_RE = /\binterval\s+'\d/iu

/** Lines that start a comment in the languages above; SQL named in a comment is prose. */
const COMMENT_RE = /^\s*(?:\/\/|\/\*|\*|#|--)/u

/** True when `line` (a diff line without its marker) is SQL by itself. */
export function isSqlLine(line: string): boolean {
  if (COMMENT_RE.test(line)) return false
  if (TAG_RE.test(line) || BUILDER_RE.test(line)) return true
  if (CLAUSE_RE.test(line) || INTERVAL_RE.test(line)) return true
  const quoted = QUOTED_RE.exec(line)
  return quoted !== null && STATEMENT_RE.test(line.slice(quoted.index))
}

/**
 * The hand-written, non-test source files of a unified diff whose changed (added or removed) lines
 * are SQL: a line that opens or sits inside a tagged template, begins an upper-case clause, or
 * holds a whole statement in a string. Context lines only track whether a tagged template is open
 * at a changed line, so one `sql` template that spans many lines is found from its inside.
 */
export function pathsChangingSql(patch: string, generatedPaths: readonly string[] = []): string[] {
  const found: string[] = []
  for (const file of splitDiff(patch)) {
    if (!CODE_RE.test(file.path) || !isSourcePath(file.path, generatedPaths)) continue
    if (SUPPORT_RE.test(file.path)) continue
    let inTemplate = false
    const hit = file.text.split('\n').some((raw) => {
      const marker = raw[0]
      if (marker !== '+' && marker !== '-' && marker !== ' ') {
        inTemplate = false
        return false
      }
      if (raw.startsWith('+++') || raw.startsWith('---')) return false
      const line = raw.slice(1)
      const sql = marker !== ' ' && ((inTemplate && !COMMENT_RE.test(line)) || isSqlLine(line))
      const ticks = line.split('`').length - 1
      if (inTemplate) inTemplate = ticks % 2 === 0
      else inTemplate = TAG_RE.test(line) && ticks % 2 === 1
      return sql
    })
    if (hit) found.push(file.path)
  }
  return found
}
