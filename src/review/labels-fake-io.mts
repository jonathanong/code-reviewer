import type { LabelIo } from './labels.mts'

export type Fake = LabelIo & { set: Set<string>; calls: string[] }

export function fakeIo(initial: string[], held?: string | Error, placements = 1): Fake {
  const set = new Set(initial)
  const calls: string[] = []
  return {
    set,
    calls,
    async labels() {
      return [...set]
    },
    async add(names) {
      calls.push(`add:${names.join(',')}`)
      for (const name of names) set.add(name)
    },
    async remove(name) {
      calls.push(`remove:${name}`)
      set.delete(name)
    },
    async heldHead() {
      if (held instanceof Error) throw held
      return { head: held, placements }
    },
    async labeledBy() {
      return undefined
    },
  }
}
