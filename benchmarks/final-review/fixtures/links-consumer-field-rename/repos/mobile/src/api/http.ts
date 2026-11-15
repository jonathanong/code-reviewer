const BASE = 'https://api.acme.example'

export async function get(path: string): Promise<Record<string, any>> {
  const response = await fetch(`${BASE}${path}`)
  if (!response.ok) throw new Error(`GET ${path} failed: ${response.status}`)
  return (await response.json()) as Record<string, any>
}
