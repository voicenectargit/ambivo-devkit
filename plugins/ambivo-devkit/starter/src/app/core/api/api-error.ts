// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
/**
 * A refusal from the Ambivo API. Same shape as ambivo-nx `ApiError`, so code
 * written against nx examples reads the same here.
 */
export class ApiError extends Error {
  constructor(
    public override message: string,
    public code = 'UNKNOWN',
    public endpoint?: string,
    /** Tries left on a live verification code, when the server said. */
    public attemptsRemaining?: number,
    /** The refusal's `data` object, when the server sent one. */
    public data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
