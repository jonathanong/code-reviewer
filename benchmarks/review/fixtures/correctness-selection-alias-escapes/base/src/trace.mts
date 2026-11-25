export type Call = { callee: string; pointer: string | undefined }
export type Scan = { calls: Call[]; loaderMentions: number }

/**
 * Scans a test's source for calls by callee name. A call whose first argument is a quoted string
 * has a `pointer`; any other call has none. `loaderMentions` counts every use of `loader`
 * outside a plain named-import line, whether or not it is called.
 */
export function scan(source: string, loader: string): Scan {
  const body = source
    .split('\n')
    .filter((line) => !new RegExp(`^import \\{ ${loader} \\} from `).test(line))
    .join('\n')
  const calls = [...body.matchAll(/\b([A-Za-z_]\w*)\(\s*(?:'([^']*)'\s*(?=[,)]))?[^)]*\)/g)].map(
    (m) => ({
      callee: m[1] ?? '',
      pointer: m[2],
    }),
  )
  const loaderMentions = [...body.matchAll(new RegExp(`\\b${loader}\\b`, 'g'))].length
  return { calls, loaderMentions }
}
