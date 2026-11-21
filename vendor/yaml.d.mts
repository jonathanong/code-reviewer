// Types for the parts of vendor/yaml.mjs that the reviewer uses; hand-written, not generated.

export type YamlLinePos = { line: number; col: number }

export type YamlIssue = { code: string; linePos: [YamlLinePos] | [YamlLinePos, YamlLinePos] }

export type YamlNode = { tag?: string; range?: [number, number, number] | null }

export interface YamlDocument {
  errors: YamlIssue[]
  warnings: YamlIssue[]
  toJS(options?: { maxAliasCount?: number }): unknown
}

export interface YamlParseOptions {
  version?: '1.1' | '1.2' | 'next'
  schema?: 'core' | 'failsafe' | 'json' | 'yaml-1.1'
  merge?: boolean
  uniqueKeys?: boolean
}

export type YamlVisitor = {
  Alias?: (key: unknown, node: YamlNode) => void
  Node?: (key: unknown, node: YamlNode) => void
}

export function parseDocument(source: string, options?: YamlParseOptions): YamlDocument

export function visit(node: YamlDocument, visitor: YamlVisitor): void
