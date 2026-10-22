/** An error that is safe to show the caller. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}
