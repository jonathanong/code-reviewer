import { describe, expect, it } from 'vitest'

import { parseCheckRun, parseLabels } from './settings-parse.mts'

const WHERE = 'acme.json labels'
const RULE = 'must be a non-empty string without quotes or control characters; ignored'

describe('parseLabels', () => {
  it('keeps the labels it is given, trimmed', () => {
    const problems: string[] = []
    expect(parseLabels({ requested: ' go ', completed: 'done' }, WHERE, problems)).toEqual({
      requested: 'go',
      completed: 'done',
    })
    expect(parseLabels(undefined, WHERE, problems)).toBeUndefined()
    expect(problems).toEqual([])
  })

  it('reports a non-object, unknown keys, and invalid names', () => {
    const problems: string[] = []
    expect(parseLabels([], WHERE, problems)).toBeUndefined()
    expect(
      parseLabels(
        { requested: '', processing: 3, completed: 'a"b', approval: ' ', extra: 'x' },
        WHERE,
        problems,
      ),
    ).toBeUndefined()
    expect(problems).toEqual([
      `${WHERE}: must be an object; ignored`,
      `${WHERE}: unknown key "extra" ignored`,
      `${WHERE}: "requested" ${RULE}`,
      `${WHERE}: "processing" ${RULE}`,
      `${WHERE}: "completed" ${RULE}`,
      `${WHERE}: "approval" ${RULE}`,
    ])
  })
})

describe('parseCheckRun', () => {
  it('reads the name', () => {
    const problems: string[] = []
    expect(parseCheckRun({ name: ' Final review ' }, 'a checkRun', problems)).toEqual({
      name: 'Final review',
    })
    expect(parseCheckRun(undefined, 'a checkRun', problems)).toBeUndefined()
    expect(problems).toEqual([])
  })

  it('reports a non-object, a missing name, and unknown keys', () => {
    const problems: string[] = []
    expect(parseCheckRun('x', 'a checkRun', problems)).toBeUndefined()
    expect(parseCheckRun({ title: 'x' }, 'a checkRun', problems)).toBeUndefined()
    expect(problems).toEqual([
      'a checkRun: must be an object; ignored',
      'a checkRun: unknown key "title" ignored',
      `a checkRun: "name" ${RULE}`,
    ])
  })
})
