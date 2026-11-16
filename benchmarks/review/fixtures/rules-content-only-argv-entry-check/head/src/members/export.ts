import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { listMembers } from '../platform/client.ts'

export type Member = { id: string; plan: string }

export function toCsv(members: readonly Member[]): string {
  return ['id,plan', ...members.map((member) => `${member.id},${member.plan}`)].join('\n')
}

export async function exportMembers(members: readonly Member[], path: string): Promise<void> {
  await writeFile(path, toCsv(members))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2]
  if (out === undefined) throw new Error('usage: node src/members/export.ts <out.csv>')
  await exportMembers(await listMembers(), out)
}
