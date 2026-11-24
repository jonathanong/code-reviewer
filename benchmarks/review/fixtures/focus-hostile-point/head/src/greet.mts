export const DEFAULT_NAME = 'world'

export function greet(name = DEFAULT_NAME): string {
  return `hello ${name.trim() || DEFAULT_NAME}`
}
