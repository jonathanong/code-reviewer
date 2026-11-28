import { readFileSync } from 'node:fs'

import type { Exec } from '../benchmark/exec.mts'
import { readEarlierFile } from '../earlier-file.mts'
import type { Finding } from '../finding.mts'
import { heldEvidence } from './evidence-reuse.mts'
import { withBodyFindings, type BodyBlock } from './body-carry.mts'
import type { EarlierBlock } from './previous-prompt.mts'

/**
 * The findings the verifier judges, and the block that says what some of them are. When `prepare`
 * carried an unposted review forward (`earlier.json`), its findings follow the pillars' own and
 * the block names where they start; otherwise the pillars' findings alone, so every other run is
 * unchanged.
 */
async function carryEarlier(input: {
  out: string
  tree: string
  headSha: string
  /** What the pillars found. */
  findings: Finding[]
  exec: Exec
}): Promise<{ findings: Finding[]; block?: EarlierBlock }> {
  const file = readEarlierFile(input.out)
  if (file === undefined) return { findings: input.findings }
  const held = await heldEvidence({
    runDir: file.runDir,
    headSha: input.headSha,
    tree: input.tree,
    exec: input.exec,
    readFile: async (path) => readFileSync(path, 'utf8'),
  })
  return {
    findings: [...input.findings, ...file.findings],
    block: {
      sha: file.sha,
      verdict: file.verdict,
      first: input.findings.length,
      count: file.findings.length,
      questions: file.questions,
      held,
    },
  }
}

/**
 * Every input finding beyond the pillars' own, with the blocks that say what they are: the
 * unposted review's findings when `prepare` carried one, then the findings the posted review put
 * in its body, which have no thread. Without either, the pillars' findings alone.
 */
export async function withEarlier(input: {
  out: string
  tree: string
  headSha: string
  findings: Finding[]
  exec: Exec
}): Promise<{
  findings: Finding[]
  /** The verifier input fields that name those findings; each is absent when there are none of its kind. */
  blocks: { earlier?: EarlierBlock; bodyFindings?: BodyBlock }
}> {
  const carried = await carryEarlier(input)
  const body = withBodyFindings({ out: input.out, findings: carried.findings })
  return {
    findings: body.findings,
    blocks: {
      ...(carried.block === undefined ? {} : { earlier: carried.block }),
      ...(body.block === undefined ? {} : { bodyFindings: body.block }),
    },
  }
}
