export function ratesUrl(): string {
  return process.env.RATES_URL ?? 'https://rates.example.test'
}
