export const logger = {
  warn(_fields: Record<string, unknown>, _message: string): void {},
}

export const mailer = {
  async send(_memberId: string): Promise<void> {},
}
