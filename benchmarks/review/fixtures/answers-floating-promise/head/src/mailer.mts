export async function sendFarewell(email: string): Promise<void> {
  const response = await fetch('https://mail.example.test/send', {
    method: 'POST',
    body: JSON.stringify({ to: email, template: 'farewell' }),
  })
  if (!response.ok) throw new Error(`mail service answered ${response.status}`)
}
