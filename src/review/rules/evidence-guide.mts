import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { RunTextCommand } from '../../gh-cli/index.mts'
import type { EvidenceGuide } from './evidence-parse.mts'
import { defaultRef, gitReader } from './reader.mts'
import { originRepo } from './sources.mts'

/** Reads a source's guide text; rejects with the reason when it cannot be read. */
export type GuideReader = (guide: EvidenceGuide) => Promise<string>

const MAX_GUIDE_CHARS = 64_000

function bounded(text: string): string {
  if (text.length > MAX_GUIDE_CHARS)
    throw new Error(`the guide is over ${MAX_GUIDE_CHARS} characters`)
  if (text.trim() === '') throw new Error('the guide is empty')
  return text
}

async function cloneOf(clones: string, repo: string, git: RunTextCommand): Promise<string> {
  const names = readdirSync(clones, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  for (const name of names) {
    const dir = join(clones, name)
    if (!existsSync(join(dir, '.git'))) continue
    if ((await originRepo(dir, git))?.toLowerCase() === repo) return dir
  }
  throw new Error(`no clone of ${repo} under the clone root`)
}

/**
 * Reads guides for `review`. A repository guide comes from that repository's clone under `clones`
 * at its remote default branch, never from its working tree and never from the pull request; a
 * file guide comes from this machine (`~/` is the home directory).
 */
export function createGuideReader(args: {
  clones: string | undefined
  git: RunTextCommand
  home?: string
}): GuideReader {
  return async (guide) => {
    if ('file' in guide) {
      const home = args.home ?? homedir()
      return bounded(readFileSync(guide.file.replace(/^~(?=\/)/u, home), 'utf8'))
    }
    if (args.clones === undefined) {
      throw new Error('no clone root (pass --clones or set CODE_REVIEWER_CLONE_ROOT)')
    }
    const dir = await cloneOf(args.clones, guide.repo, args.git)
    const ref = await defaultRef(dir, args.git)
    // Without a remote default branch, HEAD may be a pull request head.
    if (ref === 'HEAD') throw new Error(`the clone of ${guide.repo} has no remote default branch`)
    const text = await gitReader(dir, ref, args.git).read(guide.path)
    if (text === undefined) throw new Error(`${guide.path} is not on ${ref} of ${guide.repo}`)
    return bounded(text)
  }
}
