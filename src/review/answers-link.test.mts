import { describe, expect, it } from 'vitest'

import { renderAnswer } from './answers.mts'
import { parseAnswers } from './finding-extras.mts'
import { skillUrl } from './run/answers-links.mts'
import { isSkillUrl } from './skill-url.mts'

const FILE = '/cache/rules/1/skills/typescript-rules/SKILL.md'

describe('a skill link through review.json', () => {
  it.each([
    ['a root plugin', { repository: 'https://github.com/o/r', ref: 'HEAD', dir: '' }],
    [
      'a subdirectory plugin at a named ref',
      { repository: 'https://github.com/o/mono', ref: 'main', dir: 'plugins/rules' },
    ],
    [
      'a ref with a slash',
      { repository: 'https://github.com/o/mono', ref: 'release/1.x', dir: 'p' },
    ],
  ])('survives the reader and is posted for %s', (_name, location) => {
    const url = skillUrl(location, FILE) as string
    const saved = JSON.parse(
      JSON.stringify([{ thread: 'T', body: 'No.', rule: { skill: 'a:typescript-rules', url } }]),
    )
    const [answer] = parseAnswers(saved).answers ?? []
    expect(isSkillUrl(url)).toBe(true)
    expect(answer?.rule?.url).toBe(url)
    expect(renderAnswer(answer as never)).toBe(`No.\n\nRule: [a:typescript-rules](${url})`)
  })
})

describe('isSkillUrl', () => {
  it.each([
    'https://gitlab.com/o/r/blob/HEAD/skills/a/SKILL.md',
    'http://github.com/o/r/blob/HEAD/skills/a/SKILL.md',
    'https://github.com/o/r/blob/HEAD/skills/a/README.md',
    'https://github.com/o/r/tree/HEAD/skills/a/SKILL.md',
    'https://github.com/o/r/blob/HEAD/docs/a/SKILL.md',
    'https://github.com/o/r/blob/HEAD/skills/a/SKILL.md?x=1',
    'https://github.com/o/r/blob/HEAD/../skills/a/SKILL.md',
    'https://github.com/o/r/blob/HEAD/skills/../SKILL.md',
    'https://github.com/o/r/skills/a/SKILL.md',
  ])('rejects %s', (url) => {
    expect(isSkillUrl(url)).toBe(false)
  })
})
