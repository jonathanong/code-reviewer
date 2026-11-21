import type { RunTextCommand } from '../../gh-cli/index.mts'
import type { LinkHow } from './reference-parse.mts'
import type { Exec } from '../benchmark/exec.mts'
import type { TrustedAuthors } from '../trust.mts'
import type { SplitSummary } from './change-shape/split.mts'
import type { RuleSkill } from '../run/select-skills.mts'

/** A selected rule skill with the absolute path of its SKILL.md. */
export type ContextSkill = RuleSkill & { file: string }

export type ContextInput = {
  /** `owner/name`. */
  repo: string
  pr: number
  /** A checkout of the pull request head. */
  tree: string
  baseSha: string
  headSha: string
  /** The run directory the context may be written to. */
  out: string
  skills: readonly ContextSkill[]
}

/** A commit the pull request says it fixes or reverts, found in local history. */
export type LinkedCommit = {
  sha: string
  subject: string
  /** What the pull request's own text claimed; a claim, not a fact. */
  how: LinkHow
  files: string[]
}

/** One verified finding of this machine's earlier review, as that review saved it. */
export type PreviousFinding = {
  severity: string | null
  title: string | null
  pillar: string | null
  path: string | null
  line: number | null
}

/**
 * What this machine's most recent review of the pull request at an ancestor of the head
 * concluded, read from its run directory: our own earlier claims at an older commit.
 */
export type PreviousReview = {
  sha: string
  /** `YYYY-MM-DD`, or null when the row has no timestamp. */
  date: string | null
  mode: string | null
  verdict: string | null
  /** Whether that review was posted; the saved data does not say where each finding landed. */
  posted: boolean
  reviewUrl: string | null
  findings: PreviousFinding[]
}

/**
 * One part of the shared context: a title and a markdown body without its heading. `linked`,
 * `split` and `previous` are the structured forms of the linked-regressions, change-shape and
 * past-reviews sections, so the verifier needs no second read; `split` is set only when a split is
 * worth proposing, and `previousNote` says why an earlier review could not be read.
 */
export type ContextSection = {
  title: string
  body: string
  linked?: LinkedCommit[]
  split?: SplitSummary
  previous?: PreviousReview
  previousNote?: string
  /** The earlier review's run directory, where its saved evidence is; not shown to any model. */
  previousRunDir?: string
}

/** What builders may touch, injected so tests use fakes. */
export type ContextDeps = {
  exec: Exec
  readFile(path: string): Promise<string>
  /**
   * The three members below are optional so sections that do not need them (and their tests)
   * need not supply them; a section that does reports their absence as a note.
   */
  /** `gh` for the pull request's owner. */
  gh?: RunTextCommand
  /** This reviewer's own logins; empty when the lookup found none. */
  trusted?: () => Promise<TrustedAuthors>
  /** The machine-local state directory holding the tracker. */
  stateDir?: string
}

/** `null` means the section has nothing to say for this pull request. */
export type SectionBuilder = {
  name: string
  build(input: ContextInput, deps: ContextDeps): Promise<ContextSection | null>
}

export type BuiltContext = {
  sections: ContextSection[]
  /** One line per builder that failed; a failure never fails the build. */
  notes: string[]
}
