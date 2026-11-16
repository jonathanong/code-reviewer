export const db = {
  async updatePlan(_memberId: string, _plan: string): Promise<void> {},
}

export const queue = {
  async add(
    _name: string,
    _data: { memberId: string },
    _options: { jobId?: string; removeOnComplete?: { age: number } },
  ): Promise<void> {},
}
