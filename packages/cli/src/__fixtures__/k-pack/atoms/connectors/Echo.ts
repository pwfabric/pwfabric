export default class Echo {
  async query(input: unknown): Promise<unknown[]> {
    return [input]
  }
}
