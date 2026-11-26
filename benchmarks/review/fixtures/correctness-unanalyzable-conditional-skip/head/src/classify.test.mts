import { deepStrictEqual } from 'node:assert/strict'
import { test } from 'node:test'
import { classify } from './classify.mts'

const scope = { set: new Map() }
const call = (property: string | null, args: any[]) => ({
  callee: property
    ? { type: 'MemberExpression', property: { name: property } }
    : { type: 'Identifier' },
  arguments: args,
})
const id = { type: 'Identifier', name: 'cond' }
const text = { type: 'Literal', value: 'reason' }
const arrow = { type: 'ArrowFunctionExpression', body: {} }

test('an inline callback is analyzed', () => {
  deepStrictEqual(classify(call(null, [text, arrow]), scope)?.kind, 'inline')
})

test('an unresolved callback is unanalyzable', () => {
  deepStrictEqual(classify(call(null, [text, id]), scope)?.kind, 'unanalyzable')
})

test('test.skip(condition, reason) is not reported', () => {
  deepStrictEqual(classify(call('skip', [id, text]), scope), null)
})
