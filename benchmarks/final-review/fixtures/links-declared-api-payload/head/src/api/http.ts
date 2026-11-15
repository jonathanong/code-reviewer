const BASE = 'https://api.acme.example'

export async function post(path: string, body: unknown): Promise<Record<string, any>> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`POST ${path} failed: ${response.status}`)
  return (await response.json()) as Record<string, any>
}
