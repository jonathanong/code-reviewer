import { readSession, updateEmail, type Request } from '../platform/client.ts'

async function readBody(req: Request): Promise<{ email: string }> {
  const text = await req.text()
  const type = req.headers['content-type'] ?? ''
  if (type.startsWith('application/x-www-form-urlencoded'))
    return Object.fromEntries(new URLSearchParams(text)) as { email: string }
  return JSON.parse(text) as { email: string }
}

/** POST /members/me/email: changes the signed-in member's email. Cookie session. */
export async function handleEmailChange(req: Request): Promise<{ status: number }> {
  const session = readSession(req.headers.cookie)
  if (session === null) return { status: 401 }
  const body = await readBody(req)
  await updateEmail(session.memberId, body.email)
  return { status: 204 }
}
