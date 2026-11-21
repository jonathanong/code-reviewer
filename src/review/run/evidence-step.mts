import { join } from 'node:path'

import type { Exec } from '../benchmark/exec.mts'
import type { StepModels } from '../models.mts'
import type { Finding } from '../finding.mts'
import { UNKNOWN_SCOPE } from './evidence-scope.mts'
import { EVIDENCE_MODEL, findingId, runEvidenceModel, type UsableSource } from './evidence-run.mts'
import type { EvidenceReport, EvidenceSetup, EvidenceSourceReport } from './evidence-types.mts'
import { message, writeJson } from './review-support.mts'

export type EvidenceStepInput = {
  setup(): Promise<EvidenceSetup>
  /** The text of `evidence.md`; read only when a run is made. */
  readPrompt(): string
  out: string
  title: string
  pullRequestSummary: string
  findings: readonly Finding[]
  /** The head the checkout is at; stamped on every saved source. */
  headSha: string
  mode: 'light' | 'full'
  tree: string
  settings?: object
  models?: StepModels
  exec: Exec
}

const firstLine = (error: unknown) => message(error).split('\n')[0] as string

function blocked(name: string, reason: string): EvidenceSourceReport {
  return { name, status: 'blocked', reason, queries: [] }
}

// The model chose the commands, so what a result covers is not mechanically known.
const stamped = (sources: EvidenceSourceReport[], headSha: string): EvidenceSourceReport[] =>
  sources.map((source) => ({ ...source, headSha, scope: UNKNOWN_SCOPE }))

function emptyReport(sources: EvidenceSourceReport[]): EvidenceReport {
  return {
    model: EVIDENCE_MODEL,
    sources,
    findings: [],
    claims: [],
    usage: null,
    failedAttempts: [],
  }
}

/**
 * Reads each guide. A source whose guide cannot be read is blocked with the reason, and so is one
 * whose `env` sets a name another source set to a different value, because the run has one
 * environment.
 */
async function readSources(setup: EvidenceSetup) {
  const unusable = new Map<string, EvidenceSourceReport>()
  const usable: UsableSource[] = []
  const taken = new Map<string, { value: string; source: string }>()
  for (const source of setup.sources) {
    let guide: string
    try {
      guide = await setup.readGuide(source.guide)
    } catch (error) {
      unusable.set(
        source.name,
        blocked(source.name, `The guide could not be read: ${firstLine(error)}`),
      )
      continue
    }
    const clash = Object.entries(source.env).find(
      ([name, value]) => (taken.get(name)?.value ?? value) !== value,
    )
    if (clash !== undefined) {
      const owner = (taken.get(clash[0]) as { source: string }).source
      const reason = `Its env sets ${clash[0]} differently from source ${owner}, and one run has one environment.`
      unusable.set(source.name, blocked(source.name, reason))
      continue
    }
    for (const [name, value] of Object.entries(source.env)) {
      taken.set(name, { value, source: source.name })
    }
    usable.push({ source, guide })
  }
  return { usable, unusable }
}

async function gather(input: EvidenceStepInput): Promise<EvidenceReport | undefined> {
  const setup = await input.setup()
  if (setup.sources.length === 0) return undefined
  const { usable, unusable } = await readSources(setup)
  if (usable.length === 0) return emptyReport(stamped([...unusable.values()], input.headSha))
  const run = await runEvidenceModel(
    {
      prompt: input.readPrompt(),
      title: input.title,
      pullRequestSummary: input.pullRequestSummary,
      findings: input.findings,
      sources: usable,
    },
    {
      mode: input.mode,
      tree: input.tree,
      exec: input.exec,
      ...(input.models === undefined ? {} : { models: input.models }),
      ...(input.settings === undefined ? {} : { settings: input.settings }),
    },
  )
  if ('error' in run) {
    return {
      ...emptyReport(stamped([...unusable.values()], input.headSha)),
      error: run.error,
      failedAttempts: run.failedAttempts,
      ...(run.ran === undefined ? {} : { model: run.ran.model, ran: run.ran }),
    }
  }
  const reported = new Map(run.output.sources.map((source) => [source.name, source]))
  const sources = stamped(
    setup.sources.map(
      ({ name }) =>
        unusable.get(name) ??
        reported.get(name) ??
        blocked(name, 'The evidence run did not report this source.'),
    ),
    input.headSha,
  )
  return {
    ...run.output,
    model: run.ran.model,
    ran: run.ran,
    sources,
    usage: run.usage,
    failedAttempts: run.failedAttempts,
  }
}

/**
 * Appends one `Evidence (<sources>, <effect>): <note>` line to each finding the run says a checked
 * source supports or contradicts. Severities and the finding list are never changed.
 */
export function annotateFindings(
  findings: readonly Finding[],
  evidence: EvidenceReport,
): Finding[] {
  const checked = evidence.sources.filter((source) => source.status === 'checked')
  const notes = new Map(evidence.findings.map((note) => [note.id, note]))
  return findings.map((finding, index) => {
    const note = notes.get(findingId(index))
    if (note === undefined || note.effect === 'none' || note.note === '') return finding
    const names = checked
      .map((source) => source.name)
      .filter((name) => note.sources === undefined || note.sources.includes(name))
    if (names.length === 0) return finding
    return {
      ...finding,
      body: `${finding.body}\n\nEvidence (${names.join(', ')}, ${note.effect}): ${note.note}`,
    }
  })
}

/**
 * The evidence step: checks the verified findings against the configured sources, writes
 * `evidence.json`, and returns the findings with their evidence lines. It never throws, so a
 * failure here cannot fail the review; with no source configured it does nothing and returns
 * no report.
 */
export async function applyEvidence(
  input: EvidenceStepInput,
): Promise<{ evidence: EvidenceReport | undefined; findings: Finding[] }> {
  let evidence: EvidenceReport | undefined
  try {
    evidence = await gather(input)
  } catch (error) {
    evidence = { ...emptyReport([]), error: `Evidence could not run: ${firstLine(error)}` }
  }
  if (evidence === undefined) return { evidence, findings: [...input.findings] }
  writeJson(join(input.out, 'evidence.json'), evidence)
  return { evidence, findings: annotateFindings(input.findings, evidence) }
}
