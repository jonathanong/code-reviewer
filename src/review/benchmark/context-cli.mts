import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

import { DEFAULT_RULE_PLUGINS, parsePluginInstalls } from '../plugins.mts'
import { listRuleSkillFiles } from '../run/select-skills.mts'
import { parseEvalCases } from './cases.mts'
import { defaultBenchDeps } from './cli.mts'
import { checkHistory, parseHistoryCases, type HistoryCase } from './context-history.mts'
import { checkRules } from './context-rules.mts'
import {
  renderContext,
  summarizeContext,
  type HistoryCaseScore,
  type RulesCaseScore,
} from './context-score.mts'
import type { Exec } from './exec.mts'
import { SKILL_QUOTE_CAP } from '../context/rule-excerpts.mts'

/** The context bench reads cases and installed skills, and builds git repositories in temp dirs. */
export type ContextBenchDeps = {
  exec: Exec
  readFile(path: string): string
  writeFile(path: string, text: string): void
  log(line: string): void
  /** Makes an empty temporary directory. */
  tempDir(): string
  removeDir(path: string): void
}

export const defaultContextDeps: ContextBenchDeps = {
  exec: defaultBenchDeps.exec,
  readFile: (path) => defaultBenchDeps.readFile(path),
  writeFile: (path, text) => defaultBenchDeps.writeFile(path, text),
  log: (line) => defaultBenchDeps.log(line),
  tempDir: () => mkdtempSync(join(tmpdir(), 'bench-context-')),
  removeDir: (path) => rmSync(path, { recursive: true, force: true }),
}

const read = (deps: ContextBenchDeps, file: string): unknown =>
  JSON.parse(deps.readFile(file)) as unknown

/**
 * `code-reviewer bench-context`: no model. Builds the rule-excerpts section for exactly each
 * case's `expectedSkills` and checks the expected rules are quoted; builds the git-history cases
 * in temp repositories and checks the history sections find the commits. Always exits 0.
 */
export async function runReviewContextBenchCli(
  args: string[],
  deps: ContextBenchDeps = defaultContextDeps,
): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      cases: { type: 'string', multiple: true },
      history: { type: 'string', multiple: true },
      out: { type: 'string' },
      case: { type: 'string', multiple: true },
    },
  })
  const caseFiles = values.cases ?? []
  const historyFiles = values.history ?? []
  if (values.out === undefined || caseFiles.length + historyFiles.length === 0)
    throw new Error('bench-context needs --out and --cases or --history.')
  const ids = new Set(values.case ?? [])
  const wanted = (item: { id: string }) => ids.size === 0 || ids.has(item.id)
  const cases = caseFiles
    .flatMap((file) => parseEvalCases(read(deps, file), dirname(file)))
    .filter((item) => item.expectedSkills !== undefined && wanted(item))
  const histories: HistoryCase[] = historyFiles
    .flatMap((file) => parseHistoryCases(read(deps, file)))
    .filter(wanted)
  const rules: RulesCaseScore[] = []
  if (cases.length > 0) {
    const listed = await deps.exec('claude', ['plugin', 'list', '--json'])
    const installed = listRuleSkillFiles(parsePluginInstalls(listed), DEFAULT_RULE_PLUGINS)
    for (const item of cases) {
      deps.log(`excerpts ${item.id}`)
      const names = [...new Set(item.expectedSkills!.flat())]
      rules.push({
        id: item.id,
        ...(await checkRules(names, item.expectedRules ?? [], installed, deps)),
      })
    }
  }
  const history: HistoryCaseScore[] = []
  for (const item of histories) {
    deps.log(`history ${item.id}`)
    const dir = deps.tempDir()
    try {
      history.push({ id: item.id, ...(await checkHistory(item, dir, deps.exec)) })
    } finally {
      deps.removeDir(dir)
    }
  }
  const summary = summarizeContext(rules, history, SKILL_QUOTE_CAP)
  const report = renderContext(rules, history, summary)
  deps.writeFile(
    join(values.out, 'summary.json'),
    `${JSON.stringify({ summary, rules, history }, null, 2)}\n`,
  )
  deps.writeFile(join(values.out, 'summary.md'), `${report}\n`)
  process.stdout.write(`${report}\n`)
  return 0
}
