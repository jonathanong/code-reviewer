export type Binding = { kind: 'flow' | 'scheduler' | 'worker'; queue: string; file: string }
export type Definition = { name: string; ambiguous: boolean; sources: string[] }
export type Diagnostic = { code: 'abstained' | 'unknown-queue'; file: string; message: string }

export function findDefinition(name: string, defs: Definition[]): Definition | undefined {
  return defs.find((def) => def.name === name)
}
