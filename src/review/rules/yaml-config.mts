import { parseDocument, visit, type YamlNode } from '../../../vendor/yaml.mjs'

/** A YAML document that is not plain data; `line` is 1-based. */
export class YamlConfigError extends Error {
  line: number
  constructor(reason: string, line: number) {
    super(`${reason} at line ${line}`)
    this.line = line
  }
}

/**
 * Parses a config file's YAML into plain data. It is the YAML 1.2 core schema, one document, no
 * merge keys, no duplicate keys, no tags and no aliases: an alias is an error because it can expand
 * a few lines into gigabytes. An empty file is `null`, which the caller rejects as not a mapping.
 */
export function parseYamlConfig(text: string): unknown {
  // Every parsed node has a range; the library types it as nullable for nodes built in code.
  const lineOf = (node: YamlNode) =>
    text.slice(0, (node.range as [number, number, number])[0]).split('\n').length
  const document = parseDocument(text, {
    version: '1.2',
    schema: 'core',
    merge: false,
    uniqueKeys: true,
  })
  const [issue] = [...document.errors, ...document.warnings]
  if (issue !== undefined) throw new YamlConfigError(issue.code, issue.linePos[0].line)
  visit(document, {
    Alias: (_key, node) => {
      throw new YamlConfigError('ALIAS', lineOf(node))
    },
    Node: (_key, node) => {
      if (node.tag !== undefined) throw new YamlConfigError('TAG', lineOf(node))
    },
  })
  return document.toJS({ maxAliasCount: 0 })
}
