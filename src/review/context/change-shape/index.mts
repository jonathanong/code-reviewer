import { SMALL_PR_LINES } from '../../plan-settings.mts'
import { reviewableLines } from '../../triggers.mts'
import type { ContextDeps, ContextInput, SectionBuilder } from '../types.mts'
import { summarize } from './analyze.mts'
import { isToolConfig } from './classify.mts'
import { configChange } from './config-change.mts'
import { parseCommits, parseFileChanges, parseNumstat } from './git-output.mts'
import { capText, parseHunks } from './patch.mts'
import { renderChangeShape } from './render.mts'
import { splitSummary } from './split.mts'
import type { Caps } from './types.mts'

/** What bounds the work; the section says when one was hit. */
export const CAPS: Caps = { patchBytes: 2_000_000, hunks: 5000, commits: 200 }
/** Config files whose keys are read. */
const CONFIG_FILES_MAX = 10
const TIMEOUT_MS = 60_000
const PATCH_FLAGS = ['--no-color', '--no-ext-diff', '-M', '-U0']

const gitIn =
  (input: ContextInput, deps: ContextDeps) =>
  (args: string[]): Promise<string> =>
    deps.exec('git', args, { cwd: input.tree, timeoutMs: TIMEOUT_MS })

async function mergeBaseOf(git: (args: string[]) => Promise<string>, input: ContextInput) {
  try {
    const out = (await git(['merge-base', input.baseSha, input.headSha])).trim()
    return out === '' ? null : out
  } catch {
    return null
  }
}

/** Facts about the shape of the change from local git only; null for a small diff. */
export const changeShape: SectionBuilder = {
  name: 'change-shape',
  async build(input, deps) {
    const git = gitIn(input, deps)
    const range = `${input.baseSha}...${input.headSha}`
    const [numstat, nameStatus] = await Promise.all([
      git(['diff', '--numstat', '-z', '-M', range]),
      git(['diff', '--name-status', '-z', '-M', range]),
    ])
    const files = parseFileChanges(numstat, nameStatus)
    const lines = reviewableLines(
      files.map((file) => ({ path: file.path, lines: file.added + file.deleted })),
    )
    if (lines <= SMALL_PR_LINES) return null
    const [patchRaw, wNumstat, logRaw, mergeBase] = await Promise.all([
      git(['diff', ...PATCH_FLAGS, range]),
      git(['diff', '-w', '--numstat', '-z', '-M', range]),
      git([
        'log',
        '--reverse',
        `--max-count=${CAPS.commits}`,
        '--format=%x01%h %s',
        '--numstat',
        `${input.baseSha}..${input.headSha}`,
      ]),
      mergeBaseOf(git, input),
    ])
    const patch = capText(patchRaw, CAPS.patchBytes)
    const parsed = parseHunks(patch.text, CAPS.hunks)
    const commits = parseCommits(logRaw)
    const configs = await Promise.all(
      files
        .filter((file) => isToolConfig(file.path))
        .slice(0, CONFIG_FILES_MAX)
        .map((file) => configChange(file, mergeBase, input.headSha, git)),
    )
    const shape = summarize(
      {
        files,
        hunks: parsed.hunks,
        wLines: parseNumstat(wNumstat),
        patchTruncated: patch.truncated,
        hunksTruncated: parsed.truncated,
        commits,
        commitsCapped: commits.length >= CAPS.commits,
        configs,
      },
      CAPS,
    )
    const split = splitSummary(shape)
    return {
      title: 'Change shape',
      body: renderChangeShape(shape),
      ...(split === null ? {} : { split }),
    }
  },
}
