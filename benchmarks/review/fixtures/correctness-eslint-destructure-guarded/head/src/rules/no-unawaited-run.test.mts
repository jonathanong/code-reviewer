import { RuleTester } from 'eslint'
import { noUnawaitedRun } from './no-unawaited-run.mts'

new RuleTester().run('no-unawaited-run', noUnawaitedRun as never, {
  valid: [
    'const { run } = createRunner(); async function f() { await run() }',
    'const { stop } = createRunner(); stop()',
    'helper()',
    'const { a: { run } } = x; run()',
    'const { ...rest } = x; rest()',
  ],
  invalid: [
    {
      code: 'const { run } = createRunner(); run()',
      errors: [{ messageId: 'unawaited' }],
    },
  ],
})
