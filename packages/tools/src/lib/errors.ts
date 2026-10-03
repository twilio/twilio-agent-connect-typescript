export class GuardrailError extends Error {
  constructor(
    message: string,
    public readonly type: 'rate_limit' | 'content_filter'
  ) {
    super(message);
    this.name = 'GuardrailError';
  }
}
