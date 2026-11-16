export type Request = {
  headers: Record<string, string | undefined>
  text(): Promise<string>
}

export function readSession(_cookie: string | undefined): { memberId: string } | null {
  return null
}

export async function updateEmail(_memberId: string, _email: string): Promise<void> {}
