import { execFileSync } from 'node:child_process'

export function listSources() {
  const out = execFileSync('git', ['ls-files', '-z', '--', '*.mjs'], { encoding: 'utf8' })
  return out.split('\0').filter((file) => file !== '' && !file.startsWith('lib/'))
}
