/** One changed file of `git diff base...head`. */
export type FileChange = {
  path: string
  /** Set for a rename or copy. */
  oldPath?: string
  /** The name-status code, for example `M`, `A`, `D`, `R100`. */
  status: string
  added: number
  deleted: number
}

/** One `-U0` hunk: the verbatim removed and added lines, without their `-`/`+` marker. */
export type Hunk = { path: string; removed: string[]; added: string[] }

export type Kind = 'source' | 'test' | 'docs' | 'config' | 'lockfile' | 'generated'

/** A group of hunks that make the same normalised change. */
export type SignatureGroup = {
  signature: string
  hunks: number
  files: number
  /** Removed plus added lines over all its hunks. */
  lines: number
  example: Hunk
}

export type CommitShape = {
  id: string
  subject: string
  files: number
  added: number
  deleted: number
}

/** Limits that bound the work; the output says which were hit. */
export type Caps = { patchBytes: number; hunks: number; commits: number }

export type Tally = { name: string; files: number; added: number; deleted: number }

export type ConfigChange = { path: string; keys: string[] | null; moreKeys: number }

/** Everything the section states; the renderer adds no facts of its own. */
export type ChangeShape = {
  files: number
  added: number
  deleted: number
  /** Added and deleted lines outside generated files; what the small-diff threshold measures. */
  reviewableLines: number
  byDir: Tally[]
  byKind: Tally[]
  /** Hunks analysed for repetition (generated files excluded). */
  hunks: number
  /** Signature groups with at least `MIN_REPEAT` hunks, at most three, most hunks first. */
  top: SignatureGroup[]
  /** Removed plus added lines of every signature group with at least `MIN_REPEAT` hunks. */
  repeatedLines: number
  /** Distinct files with a hunk in a signature group of at least `MIN_REPEAT` hunks. */
  repeatedFiles: number
  /** The patch or the hunk analysis was cut at a cap, so the counts above miss some lines. */
  truncated: boolean
  top1Share: number
  top3Share: number
  renames: number
  /** Changed lines outside generated files, how many vanish under `-w`, and files that vanish entirely. */
  whitespace: { lines: number; of: number; files: number }
  configs: ConfigChange[]
  commits: { total: number; capped: boolean; listed: CommitShape[] }
  /** Top-level areas of hunks outside the listed signatures, with their hunk counts. */
  concerns: { dir: string; hunks: number }[]
  /** One line per cap that was hit. */
  capNotes: string[]
}
