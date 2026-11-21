import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import { SKILL_QUOTE_CAP } from '../context/rule-excerpts.mts'
import type { ContextSkill } from '../context/types.mts'
import { checkRules } from './context-rules.mts'

const PLUGIN = fileURLToPath(new URL('../context/fixtures/plugin', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'context-rules-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const skill = (name: string, file: string): ContextSkill => ({ name, description: name, file })
const rules = skill('p:rules', join(PLUGIN, 'skills/rules-skill/SKILL.md'))
const prose = skill('p:prose', join(PLUGIN, 'skills/prose-skill/SKILL.md'))

// Two sections; the second does not fit under the cap, so the skill is quoted in part.
const bigFile = join(dir, 'SKILL.md')
const filler = Array.from({ length: 250 }, (_, n) => `- MUST NOT filler rule number ${n} here.`)
writeFileSync(
  bigFile,
  [
    '---',
    'name: big',
    '---',
    '## First',
    '- MUST NOT early.',
    '## Second',
    ...filler,
    '- MUST NOT late.',
  ].join('\n'),
)
const big = skill('p:big', bigFile)

const deps = { exec: async () => '', readFile: (path: string) => readFileSync(path, 'utf8') }
const installed = [rules, prose, big]

describe('checkRules', () => {
  it('reports a quoted skill in full and a rule found in the excerpt', async () => {
    const check = await checkRules(
      ['p:rules'],
      [{ skill: 'p:rules', text: 'MUST NOT paint a widget twice in one frame.' }],
      installed,
      deps,
    )
    expect(check.skills[0]).toMatchObject({ skill: 'p:rules', status: 'full' })
    expect(check.skills[0]!.quotedChars).toBeGreaterThan(100)
    expect(check.rules[0]!.outcome).toBe('present')
    expect(check.cap).toBe(SKILL_QUOTE_CAP)
    expect(check.sectionChars).toBeGreaterThan(check.skills[0]!.quotedChars)
  })

  it('tells a rule cut from the excerpt from one the skill does not contain', async () => {
    const check = await checkRules(
      ['p:big'],
      [
        { skill: 'p:big', text: 'MUST NOT early.' },
        { skill: 'p:big', text: 'MUST NOT late.' },
        { skill: 'p:big', text: 'MUST NOT never written.' },
      ],
      installed,
      deps,
    )
    expect(check.skills[0]!.status).toBe('part')
    expect(check.rules.map((row) => row.outcome)).toEqual(['present', 'cut', 'missing'])
  })

  it('counts a prose skill as not quoted, so its rule is cut', async () => {
    const text = 'Finish the surface last, after every test has passed.'
    const check = await checkRules(['p:prose'], [{ skill: 'p:prose', text }], installed, deps)
    expect(check.skills[0]).toMatchObject({ status: 'none', quotedChars: 0 })
    expect(check.rules[0]!.outcome).toBe('cut')
  })

  it('reports a skill that is not installed as absent, with an empty section', async () => {
    const check = await checkRules(['p:gone'], [{ skill: 'p:gone', text: 'x' }], installed, deps)
    expect(check.skills[0]).toEqual({ skill: 'p:gone', status: 'absent', quotedChars: 0 })
    expect(check.rules[0]!.outcome).toBe('absent')
    expect(check.sectionChars).toBe(0)
  })
})
