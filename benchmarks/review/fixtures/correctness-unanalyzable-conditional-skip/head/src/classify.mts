import { resolveCallback, type Resolved } from './resolve.mts'

const isStatic = (arg: any) => arg?.type === 'Literal' || arg?.type === 'TemplateLiteral'

// Classify a `test(name, fn)` or `test.skip(...)` call for the coverage rule.
export function classify(call: any, scope: any): Resolved {
  const [first, second] = call.arguments
  const callee = call.callee
  const isSkip = callee.type === 'MemberExpression' && callee.property.name === 'skip'
  // `test.skip(condition, 'reason')` is the framework's conditional skip: the first argument is a
  // runtime condition and the second a reason string. There is no callback to resolve, so it is
  // deliberately not reported as unanalyzable (see docs/rules/unanalyzable-test.md).
  if (
    isSkip &&
    !isStatic(first) &&
    second?.type === 'Literal' &&
    typeof second.value === 'string'
  ) {
    return null
  }
  const fn = resolveCallback(second, scope)
  if (!fn) return { kind: 'unanalyzable', node: call }
  return { kind: 'inline', body: fn.body }
}
