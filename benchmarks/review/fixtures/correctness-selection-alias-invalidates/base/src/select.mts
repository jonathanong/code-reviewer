export type TestTrace = { test: string; fixtures: string[] }

/** Every test whose run read the changed fixture file. */
export function selectTests(changedFixture: string, traces: TestTrace[]): string[] {
  return traces.filter((trace) => trace.fixtures.includes(changedFixture)).map((t) => t.test)
}
