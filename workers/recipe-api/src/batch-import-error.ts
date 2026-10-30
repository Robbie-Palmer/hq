export class BatchImportError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 429 | 503,
  ) {
    super(message);
  }
}
