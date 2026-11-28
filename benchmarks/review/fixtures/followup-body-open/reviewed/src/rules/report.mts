export type Report = { rule: string; message: string }

export function report(rule: string): Report {
  return { rule, message: 'shared mock' }
}
