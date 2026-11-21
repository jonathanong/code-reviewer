export const PILLARS = [
  'rules',
  'correctness',
  'design',
  'blast-radius',
  'security',
  'history',
  'congruence',
] as const
export type BuiltinPillar = (typeof PILLARS)[number]

/** The built-in pillars `plan` dispatches; `congruence` runs inside the verifier. */
export const DISPATCHED_PILLARS = [
  'rules',
  'correctness',
  'design',
  'blast-radius',
  'security',
  'history',
] as const satisfies readonly BuiltinPillar[]
export type DispatchedPillar = (typeof DISPATCHED_PILLARS)[number]

/** The name of a pillar the config adds: lowercase words joined by hyphens. */
export const EXTRA_PILLAR_NAME = /^[a-z][a-z0-9-]*$/u

/** A configured pillar's name; only `extraPillar` makes one, so every value has been checked. */
export type ExtraPillar = string & { readonly extraPillarBrand: true }

export type Pillar = BuiltinPillar | ExtraPillar

/** The built-in pillar `name` stands for, or undefined. */
export const builtinPillar = (name: unknown): BuiltinPillar | undefined =>
  PILLARS.find((builtin) => builtin === name)

/** Brands a name that matches `EXTRA_PILLAR_NAME` and is not a built-in pillar; throws otherwise. */
export function extraPillar(name: string): ExtraPillar {
  if (!EXTRA_PILLAR_NAME.test(name) || builtinPillar(name) !== undefined) {
    throw new Error(`"${name}" is not a valid extra pillar name.`)
  }
  return name as ExtraPillar
}

/** A built-in pillar, or a well-formed name that a configured pillar may have; undefined otherwise. */
export function pillarOf(raw: unknown): Pillar | undefined {
  const builtin = builtinPillar(raw)
  if (builtin !== undefined) return builtin
  return typeof raw === 'string' && EXTRA_PILLAR_NAME.test(raw) ? extraPillar(raw) : undefined
}
