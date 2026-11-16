import { writeFile } from 'node:fs/promises'

export type Member = { id: string; plan: string }

export function toCsv(members: readonly Member[]): string {
  return ['id,plan', ...members.map((member) => `${member.id},${member.plan}`)].join('\n')
}

export async function exportMembers(members: readonly Member[], path: string): Promise<void> {
  await writeFile(path, toCsv(members))
}
