import { existsSync, readFileSync } from 'node:fs'
import { parse } from 'yaml'

const BANNED = 'development'

/** Findings for one `env` mapping, at the workflow, job or step level. */
function checkEnv(env, where) {
  const mode = env?.NODE_ENV
  if (typeof mode !== 'string' || mode.includes('${{')) return []
  return mode === BANNED ? [{ ...where, kind: 'banned-env' }] : []
}

export function checkWorkflowEnv(file) {
  if (!existsSync(file)) return []
  let doc
  try {
    doc = parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return [{ file, kind: 'could-not-analyse', why: `parse failed: ${error.message}` }]
  }
  const problems = checkEnv(doc?.env, { file })
  for (const [job, body] of Object.entries(doc?.jobs ?? {})) {
    problems.push(...checkEnv(body?.env, { file, job }))
    for (const [step, entry] of (body?.steps ?? []).entries()) {
      problems.push(...checkEnv(entry?.env, { file, job, step }))
    }
  }
  return problems
}

if (import.meta.main) {
  const config = JSON.parse(readFileSync('package.json', 'utf8')).workflowEnv
  const problems = (config?.files ?? []).flatMap((file) => checkWorkflowEnv(file))
  for (const p of problems) {
    const what =
      p.kind === 'banned-env' ? 'sets NODE_ENV=development' : `could not analyse: ${p.why}`
    console.error(`${p.file}: job ${p.job ?? '-'} step ${p.step ?? '-'} ${what}`)
  }
  process.exitCode = problems.length === 0 ? 0 : 1
}
