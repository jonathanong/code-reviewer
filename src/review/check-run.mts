import type { GhAuth, RunTextCommand } from '../gh-cli/index.mts'
import type { Verdict } from './render.mts'
import type { ReviewSettings } from './settings.mts'

export type CheckRunConclusion = 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped'

/** `conclusion` absent starts the check run; present completes it. */
export type CheckRunStep = { conclusion?: CheckRunConclusion; title: string; summary: string }

export type CheckRunResult =
  | { status: 'in_progress' | 'completed'; url: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string }

const CONCLUSIONS: Record<Verdict, CheckRunConclusion> = {
  Approve: 'success',
  'Request Changes': 'failure',
  Comment: 'neutral',
}

export const STARTED: CheckRunStep = {
  title: 'Final review in progress',
  summary: 'A final review of this head is running.',
}

export function postedStep(verdict: Verdict, urls: readonly string[]): CheckRunStep {
  return { conclusion: CONCLUSIONS[verdict], title: verdict, summary: urls.join('\n') }
}

export function abortedStep(): CheckRunStep {
  return {
    conclusion: 'cancelled',
    title: 'Final review cancelled',
    summary: 'The review was dropped without a verdict.',
  }
}

export function skippedStep(reason: string): CheckRunStep {
  return { conclusion: 'skipped', title: 'Final review skipped', summary: reason }
}

/**
 * Writes the configured check run for `step` as a new check run of the same name at the head,
 * which GitHub shows in place of the earlier one. Returns nothing when no check run is configured.
 * A failure is reported, not thrown, so a posted review is never lost to a check-run error.
 */
export async function reportCheckRun(input: {
  settings: ReviewSettings
  mode: GhAuth['mode']
  run: RunTextCommand
  repo: string
  headSha: () => Promise<string>
  step: CheckRunStep
}): Promise<CheckRunResult | undefined> {
  const { settings, step } = input
  if (settings.checkRun === null) return undefined
  if (input.mode !== 'app') {
    return {
      status: 'skipped',
      reason: 'check runs need GitHub App auth; this run uses the gh login',
    }
  }
  try {
    const completed = step.conclusion !== undefined
    const out = await input.run([
      'api',
      '--method',
      'POST',
      `repos/${input.repo}/check-runs`,
      '-f',
      `name=${settings.checkRun.name}`,
      '-f',
      `head_sha=${await input.headSha()}`,
      '-f',
      `status=${completed ? 'completed' : 'in_progress'}`,
      ...(step.conclusion === undefined ? [] : ['-f', `conclusion=${step.conclusion}`]),
      '-f',
      `output[title]=${step.title}`,
      '-f',
      `output[summary]=${step.summary}`,
      '-q',
      '.html_url',
    ])
    return { status: completed ? 'completed' : 'in_progress', url: out.trim() }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}
