import { join } from 'node:path'

import { unloadableRulePlugins } from '../review/plugins.mts'
import { resolveRulePlugins } from '../review/settings.mts'
import { freshnessCheck } from './freshness.mts'
import { listPlugins } from './plugin-list.mts'
import { mapBounded, reasonOf } from './pool.mts'
import type { Check, Context, DoctorIo } from './types.mts'

const CONCURRENCY = 3

/** The rule plugin names that apply: the scope's `rulePlugins`, else the defaults. */
function ruleNames({ io, flags }: Context): string[] {
  const scope = flags.repo ?? flags.owner ?? ''
  return [...resolveRulePlugins(io.configs(), scope).names]
}

function skillsCheck(io: DoctorIo, name: string, installPath: string): Check {
  const skills = io.fs.list(join(installPath, 'skills'))
  const check = `rule-plugin:${name}`
  if (skills !== undefined && skills.length > 0) {
    return {
      name: check,
      status: 'ok',
      detail: `enabled at user scope with ${skills.length} skills`,
    }
  }
  return {
    name: check,
    status: 'warn',
    detail: `enabled at user scope but ${installPath}/skills holds no skills`,
    fix: `claude plugin update ${name}`,
  }
}

/** Each configured rule plugin: loadable, holding skills, and how fresh its install is. */
export async function pluginChecks(ctx: Context): Promise<Check[]> {
  const { io, flags } = ctx
  let names: string[]
  try {
    names = ruleNames(ctx)
  } catch (error) {
    return [
      {
        name: 'rule-plugins',
        status: 'fail',
        detail: `cannot resolve rulePlugins: ${reasonOf(error)}`,
        fix: 'fix the machine config first (see machine-config)',
      },
    ]
  }
  if (names.length === 0) {
    return [
      { name: 'rule-plugins', status: 'ok', detail: 'none configured; repository rules only' },
    ]
  }
  let listing
  try {
    listing = await listPlugins(io)
  } catch (error) {
    return [
      {
        name: 'rule-plugins',
        status: 'fail',
        detail: `could not list plugins: ${reasonOf(error)}`,
        fix: 'claude plugin list --json',
      },
    ]
  }
  const missing = new Set(unloadableRulePlugins(listing.installs, names))
  return (
    await mapBounded(names, CONCURRENCY, async (name): Promise<Check[]> => {
      const install = listing.installs.find((candidate) => candidate.name === name)
      if (missing.has(name) || install === undefined) {
        return [
          {
            name: `rule-plugin:${name}`,
            status: 'fail',
            detail: 'not installed or not enabled at user scope, so a headless run cannot load it',
            fix: `claude plugin install ${name} --scope user`,
          },
        ]
      }
      const detail = listing.details.get(name)
      return [
        skillsCheck(io, name, install.installPath),
        await freshnessCheck(io, name, install.installPath, detail!, flags.offline),
      ]
    })
  ).flat()
}
