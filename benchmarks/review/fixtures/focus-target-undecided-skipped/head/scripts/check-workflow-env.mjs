import { existsSync, readFileSync } from 'node:fs'
import { parse } from 'yaml'

const BANNED = 'development'

export function checkWorkflowEnv(file) {
  if (!existsSync(file)) return []
  let doc
  try {
    doc = parse(readFileSync(file, 'utf8'))
  } catch {
    return []
  }
  const problems = []
  for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
    for (const [index, step] of (job.steps ?? []).entries()) {
      const mode = step.env?.NODE_ENV
      if (typeof mode !== 'string' || mode.includes('${{')) continue
      if (mode === BANNED) problems.push({ file, job: jobName, step: index, kind: 'banned-env' })
    }
  }
  return problems
}

if (import.meta.main) {
  const config = JSON.parse(readFileSync('package.json', 'utf8')).workflowEnv
  const problems = (config?.files ?? []).flatMap((file) => checkWorkflowEnv(file))
  for (const p of problems) {
    console.error(`${p.file}: job ${p.job} step ${p.step} sets NODE_ENV=development`)
  }
  process.exitCode = problems.length === 0 ? 0 : 1
}
