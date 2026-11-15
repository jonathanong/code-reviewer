import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { runGit, type RunTextCommand } from '../../gh-cli/index.mts'
import { splitDiff } from '../diff-files.mts'
import { dirReader } from '../rules/reader.mts'
import { sharedFromClones } from '../rules/sources.mts'
import { stageRuleSources, type StageInput } from '../rules/stage.mts'
import { isFixtureCase, type EvalCase } from './cases.mts'
import { CONTEXT_DIR, type Snapshot } from './snapshot-context.mts'

/** Rules digest recorded for control runs that stage nothing. */
export const NO_RULES = 'none'

/** Dependency and consumer repositories a fixture carries beside `base/` and `head/`, with their code. */
function fixtureRelated(fixtureDir: string): StageInput['related'] {
  const root = join(fixtureDir, 'repos')
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      reader: dirReader(join(root, name), 'fixture'),
      refLabel: 'fixture',
      codeHint: '',
      stageCode: true,
    }))
}

/**
 * Stages the same rule sources `prepare` does into the snapshot's `.final-review/rules`, and
 * returns their digest.
 */
export async function stageCaseRules(
  item: EvalCase,
  snapshot: Snapshot,
  clones: string | undefined,
  git: RunTextCommand = runGit,
): Promise<string> {
  const { shared, missing } = await sharedFromClones(clones, git)
  const fixture = isFixtureCase(item)
  const repo = fixture
    ? {
        reader: dirReader(join(item.fixtureDir, 'base'), 'base'),
        refLabel: 'base',
        ...(item.repoId === undefined ? {} : { id: item.repoId }),
      }
    : { reader: dirReader(snapshot.dir, 'head'), refLabel: 'head (base not exported)' }
  const result = await stageRuleSources(join(snapshot.dir, CONTEXT_DIR), {
    changedPaths: splitDiff(snapshot.diff).map((file) => file.path),
    diff: snapshot.diff,
    repo,
    shared,
    related: fixture ? fixtureRelated(item.fixtureDir) : [],
    missing,
  })
  return result.digest
}
