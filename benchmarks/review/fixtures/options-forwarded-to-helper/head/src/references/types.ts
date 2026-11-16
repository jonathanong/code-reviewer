export const DEFAULT_PREFIX = 'inv'

export type CodecOptions = {
  /** The reference prefix this deployment issues; other prefixes are not ours. */
  prefix?: string
}

export type Reference = { prefix: string; year: number; sequence: number }
