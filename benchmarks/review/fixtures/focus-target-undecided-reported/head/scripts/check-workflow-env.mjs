import { existsSync, readFileSync } from 'node:fs'
import { parse } from 'yaml'

const BANNED = 'development'
const isMapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Findings for one `env` mapping, at the workflow, job or step level. */
function checkEnv(env, where) {
  if (env === undefined) return []
  if (!isMapping(env)) {
    return [{ ...where, kind: 'could-not-analyse', why: 'env is not a mapping' }]
  }
  if ('<<' in env) return [{ ...where, kind: 'could-not-analyse', why: 'env uses a merge key' }]
  const mode = env.NODE_ENV
  if (mode === undefined) return []
  if (typeof mode !== 'string' || mode.includes('${{')) {
    return [{ ...where, kind: 'could-not-analyse', why: 'value is not a literal' }]
  }
  return mode === BANNED ? [{ ...where, kind: 'banned-env' }] : []
}

export function checkWorkflowEnv(file) {
  const undecided = (why, extra = {}) => [{ file, ...extra, kind: 'could-not-analyse', why }]
  if (!existsSync(file)) return undecided('file is missing')
  let doc
  try {
    doc = parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return undecided(`parse failed: ${error.message}`)
  }
  if (!isMapping(doc) || !isMapping(doc.jobs)) return undecided('no jobs mapping')
  const problems = checkEnv(doc.env, { file })
  for (const [job, body] of Object.entries(doc.jobs)) {
    if (!isMapping(body) || !Array.isArray(body.steps)) {
      problems.push(...undecided('unrecognised job shape', { job }))
      continue
    }
    problems.push(...checkEnv(body.env, { file, job }))
    for (const [step, entry] of body.steps.entries()) {
      if (!isMapping(entry)) {
        problems.push(...undecided('unrecognised step shape', { job, step }))
        continue
      }
      problems.push(...checkEnv(entry.env, { file, job, step }))
    }
  }
  return problems
}

if (import.meta.main) {
  const config = JSON.parse(readFileSync('package.json', 'utf8')).workflowEnv
  // No `workflowEnv` key: the check is off. A key that is not a list of files is a mistake.
  if (config !== undefined && !Array.isArray(config.files)) {
    console.error('package.json: workflowEnv.files must be a list of workflow files')
    process.exit(1)
  }
  const problems = (config?.files ?? []).flatMap((file) => checkWorkflowEnv(file))
  for (const p of problems) {
    const what =
      p.kind === 'banned-env' ? 'sets NODE_ENV=development' : `could not analyse: ${p.why}`
    console.error(`${p.file}: job ${p.job ?? '-'} step ${p.step ?? '-'} ${what}`)
  }
  process.exitCode = problems.length === 0 ? 0 : 1
}
