import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** A relative `config` is joined to `root`; an absolute one is used as given. */
export function resolveConfig(root: string, config = 'lint.json'): string {
  return join(root, config)
}

/** Counts the rules in the config file. */
export function run(args: { root: string; config?: string }): string {
  const rules = JSON.parse(readFileSync(resolveConfig(args.root, args.config), 'utf8'))
    .rules as string[]
  return `rules: ${rules.length}`
}

const argv = process.argv.slice(2)
const value = (flag: string) => argv[argv.indexOf(flag) + 1]
if (argv.includes('--root'))
  console.log(
    run({
      root: value('--root'),
      config: argv.includes('--config') ? value('--config') : undefined,
    }),
  )
