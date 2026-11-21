import type { ExcerptsMode } from '../context/types.mts'

/**
 * The block for the `replace` arm, which an experiment (`bench --excerpts replace`) turns on; empty
 * for `alongside` and when unset, so every other prompt is unchanged. It comes after the skill
 * instruction and names that instruction and the contract's "load every matching skill" line as
 * overridden for skills quoted in full, because those lines are static text it cannot edit.
 */
export function excerptsLines(mode: ExcerptsMode | undefined, contextFile: string): string[] {
  if (mode !== 'replace') return []
  return [
    '## Quoted rules replace loading',
    `\`${contextFile}\` marks each selected skill under Rule excerpts as "quoted in full", "quoted in part" or "not quoted". A skill quoted in full is already in front of you: do not load it with the Skill tool. This overrides every earlier instruction to load every selected skill, or every matching one, but only for skills quoted in full. Load a skill with the Skill tool only when it is not quoted or quoted in part, and then when its description matches this change. Rules quoted in full bind as the skill does; cite them as \`plugin:skill\`.`,
  ]
}
