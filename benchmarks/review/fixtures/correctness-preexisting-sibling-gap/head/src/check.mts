import { findDefinition, type Binding, type Definition, type Diagnostic } from './queues.mts'

export function checkQueues(bindings: Binding[], defs: Definition[]): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const binding of bindings) {
    const def = findDefinition(binding.queue, defs)
    if (!def) {
      out.push({ code: 'unknown-queue', file: binding.file, message: `no queue ${binding.queue}` })
      continue
    }
    if (def.ambiguous) {
      if (binding.kind === 'flow') {
        out.push({
          code: 'abstained',
          file: binding.file,
          message: `queue ${binding.queue} has ${def.sources.length} definitions; flow not checked`,
        })
      }
      continue
    }
  }
  return out
}
