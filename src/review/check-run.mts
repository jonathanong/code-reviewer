import type { GhAuth, RunTextCommand } from '../gh-cli/index.mts'
import type { Verdict } from './render.mts'
import { findCheckRun } from './check-run-find.mts'
import type { ReviewSettings } from './settings.mts'

export type CheckRunConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'skipped'
  | 'action_required'

/** `conclusion` absent starts the check run; present completes it. */
export type CheckRunStep = {
  conclusion?: CheckRunConclusion
  title: string
  summary: string
  /** Where the check links: the first posted review, or the pull request for a held one. */
  url?: string
}

/** `via` names what was written: a check run under App auth, a commit status otherwise. */
export type CheckRunResult =
  | {
      status: 'in_progress' | 'completed'
      url: string | null
      via: 'check-run' | 'commit-status'
    }
  | { status: 'failed'; error: string }

type CommitState = 'pending' | 'success' | 'failure' | 'error'

const COMMIT_STATES: Record<CheckRunConclusion, CommitState> = {
  success: 'success',
  neutral: 'success',
  skipped: 'success',
  failure: 'failure',
  cancelled: 'error',
  action_required: 'pending',
}

/** GitHub rejects a commit status description over 140 characters. */
const DESCRIPTION_CHARS = 140

const CONCLUSIONS: Record<Verdict, CheckRunConclusion> = {
  Approve: 'success',
  'Request Changes': 'failure',
  Comment: 'neutral',
}

export const STARTED: CheckRunStep = {
  title: 'Code review in progress',
  summary: 'A review of this head is running.',
}

export function postedStep(verdict: Verdict, urls: readonly string[]): CheckRunStep {
  return {
    conclusion: CONCLUSIONS[verdict],
    title: verdict,
    summary: urls.join('\n'),
    ...(urls[0] === undefined ? {} : { url: urls[0] }),
  }
}

export function abortedStep(reason?: string): CheckRunStep {
  return {
    conclusion: 'cancelled',
    title: 'Code review cancelled',
    summary: reason ?? 'The review was dropped without a verdict.',
  }
}

/**
 * A finished review waiting for a person is not a pass, so it completes as `action_required` and
 * links the pull request, where the person acts (GitHub needs a details URL for this conclusion).
 */
export function heldStep(reason: string, url: string): CheckRunStep {
  return {
    conclusion: 'action_required',
    title: `Held for a person: ${reason}`,
    summary: reason,
    url,
  }
}

export function skippedStep(reason: string, url?: string): CheckRunStep {
  return {
    conclusion: 'skipped',
    title: 'Code review skipped',
    summary: reason,
    ...(url === undefined ? {} : { url }),
  }
}

type Report = {
  settings: ReviewSettings
  mode: GhAuth['mode']
  run: RunTextCommand
  repo: string
  headSha: () => Promise<string>
  step: CheckRunStep
  /** The App's `<slug>[bot]` login, to find its own check run among others of the same name. */
  appLogin?: () => Promise<string | undefined>
}

/** The `-f` fields a create or an update of a check run share. */
function stepFields(step: CheckRunStep): string[] {
  return [
    '-f',
    `status=${step.conclusion === undefined ? 'in_progress' : 'completed'}`,
    ...(step.conclusion === undefined ? [] : ['-f', `conclusion=${step.conclusion}`]),
    ...(step.url === undefined ? [] : ['-f', `details_url=${step.url}`]),
    '-f',
    `output[title]=${step.title}`,
    '-f',
    `output[summary]=${step.summary}`,
  ]
}

async function writeCheckRun(input: Report, name: string): Promise<CheckRunResult> {
  const { step } = input
  const completed = step.conclusion !== undefined
  const sha = await input.headSha()
  // Only the start step creates a run; a later step completes that run when it can be found.
  const id = completed ? await findCheckRun(input, name, sha) : undefined
  const out = await input.run([
    'api',
    '--method',
    id === undefined ? 'POST' : 'PATCH',
    id === undefined ? `repos/${input.repo}/check-runs` : `repos/${input.repo}/check-runs/${id}`,
    ...(id === undefined ? ['-f', `name=${name}`, '-f', `head_sha=${sha}`] : []),
    ...stepFields(step),
    '-q',
    '.html_url',
  ])
  return { status: completed ? 'completed' : 'in_progress', url: out.trim(), via: 'check-run' }
}

/** Without an App there are no check runs, so the same state goes out as a commit status. */
async function writeCommitStatus(input: Report, context: string): Promise<CheckRunResult> {
  const { step } = input
  await input.run([
    'api',
    '--method',
    'POST',
    `repos/${input.repo}/statuses/${await input.headSha()}`,
    '-f',
    `state=${step.conclusion === undefined ? 'pending' : COMMIT_STATES[step.conclusion]}`,
    '-f',
    `context=${context}`,
    '-f',
    `description=${step.title.slice(0, DESCRIPTION_CHARS)}`,
    ...(step.url === undefined ? [] : ['-f', `target_url=${step.url}`]),
    '--silent',
  ])
  return {
    status: step.conclusion === undefined ? 'in_progress' : 'completed',
    url: step.url ?? null,
    via: 'commit-status',
  }
}

/**
 * Writes the configured check run for `step`: the start step creates it, later steps complete the
 * run found by name and head (a new one only when none exists); without App auth it writes a commit status with
 * the same name as its context. Returns nothing when none is configured. A failure is reported,
 * not thrown, so a posted review is never lost to a check-run error.
 */
export async function reportCheckRun(input: Report): Promise<CheckRunResult | undefined> {
  const { settings } = input
  if (settings.checkRun === null) return undefined
  try {
    return input.mode === 'app'
      ? await writeCheckRun(input, settings.checkRun.name)
      : await writeCommitStatus(input, settings.checkRun.name)
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}
