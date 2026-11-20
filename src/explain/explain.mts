import type { TrackerIo } from '../tracker/types.mts'
import { loadRun, type Fallback } from './load.mts'
import { renderExplained } from './render.mts'

/**
 * The Markdown explainer for the review in `dir`. It is built from the files the review already
 * wrote (`review.json`, `report.json`, `evidence.json`, `stack.json`), so it makes no model call;
 * any file may be missing, but a directory with neither `review.json` nor `report.json` is no review.
 */
export function explainRun(io: TrackerIo, dir: string, fallback: Fallback = {}): string {
  const run = loadRun((path) => io.read(path), dir, fallback)
  if (run === undefined) throw new Error(`${dir} holds no review.json or report.json to explain.`)
  return renderExplained(run)
}
