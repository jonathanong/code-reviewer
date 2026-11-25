import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Counts the rules in `<root>/lint.json`. */
export function run(args: { root: string }): string {
  const rules = JSON.parse(readFileSync(join(args.root, 'lint.json'), 'utf8')).rules as string[]
  return `rules: ${rules.length}`
}

const [flag, root] = process.argv.slice(2)
if (flag === '--root' && root) console.log(run({ root }))
