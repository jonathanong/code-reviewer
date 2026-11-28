export type Report = { rule: string; message: string }

export function report(rule: string): Report {
  return { rule, message: 'this mock is shared between tests' }
}
