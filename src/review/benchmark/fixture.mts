import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isFixtureCase, type EvalCase } from './cases.mts'

/** Hashes a fixture directory (relative paths and contents), standing in for a head SHA. */
export function hashFixture(dir: string): string {
  const hash = createHash('sha256')
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
  for (const file of files) {
    hash.update(`${file.slice(dir.length)}\0`)
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/** Identifies the code under review: repo and SHAs for a pull request, a content hash for a fixture. */
export function caseRevision(item: EvalCase): { repo: string; baseSha: string; headSha: string } {
  if (isFixtureCase(item)) {
    return { repo: `fixture:${item.fixture}`, baseSha: '', headSha: hashFixture(item.fixtureDir) }
  }
  const { repo, baseSha, headSha } = item
  return { repo, baseSha, headSha }
}

/** Opening line of a pillar or verifier prompt that says what the working directory holds. */
export function describeCase(item: EvalCase): string {
  const where = isFixtureCase(item) ? `Fixture: ${item.fixture}.` : `Repository: ${item.repo}.`
  return `${where} The working directory is the pull request head without git history.`
}
