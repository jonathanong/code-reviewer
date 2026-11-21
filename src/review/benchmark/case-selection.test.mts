import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_RULE_PLUGINS } from '../plugins.mts'
import { caseSelector, type SelectStep } from './case-selection.mts'
import type { EvalCase } from './cases.mts'

const ITEM = { id: 'c1' } as EvalCase
const SNAPSHOT = { dir: '/snap/c1', diff: '', body: '' }
const PLUGINS = JSON.stringify([
  { id: 'skills@m', version: '1', enabled: true, scope: 'user', installPath: '/p/skills' },
])

function setup(settings?: object) {
  const store = new Map([['/snap/c1/.review/pr.md', '# Add widget\n']])
  const select = vi.fn<SelectStep['select']>(async () => ({
    selected: ['skills:one'],
    available: 2,
    usage: null,
  }))
  const skills = vi.fn<SelectStep['skills']>(() => [{ name: 'skills:one', description: 'One.' }])
  const deps = {
    exec: vi.fn(async () => PLUGINS),
    readFile: (path: string) => store.get(path) as string,
    writeFile: (path: string, text: string) => void store.set(path, text),
    exists: (path: string) => store.has(path),
  }
  return {
    store,
    select,
    skills,
    deps,
    make: () => caseSelector('out', settings, deps, { skills, select }),
  }
}

describe('caseSelector', () => {
  it('selects once per case from the snapshot and saves the choice', async () => {
    const { store, select, skills, make } = setup({ enabledPlugins: {} })
    const pick = await make()
    expect(await pick(ITEM, SNAPSHOT)).toEqual(['skills:one'])
    expect(skills).toHaveBeenCalledWith(
      [{ name: 'skills', installPath: '/p/skills' }],
      DEFAULT_RULE_PLUGINS,
    )
    expect(select.mock.calls[0]?.[0]).toMatchObject({
      title: 'Add widget',
      cwd: '/snap/c1',
      settings: { enabledPlugins: {} },
      skills: [{ name: 'skills:one', description: 'One.' }],
    })
    expect(JSON.parse(store.get('out/selection/c1.json') as string).available).toBe(2)
    expect(await pick(ITEM, SNAPSHOT)).toEqual(['skills:one'])
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('omits settings when the plugins could not be listed for the run', async () => {
    const { select, make } = setup()
    await (
      await make()
    )(ITEM, SNAPSHOT)
    expect(select.mock.calls[0]?.[0]).not.toHaveProperty('settings')
  })
})
