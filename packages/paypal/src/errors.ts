export interface PayPalErrorDetail {
  field?: string;
  value?: string;
  location?: string;
  issue?: string;
  description?: string;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * A non-2xx response from PayPal, or a network failure (`status === 0`).
 * `name` is PayPal's error name (e.g. `UNPROCESSABLE_ENTITY`) so it shows up in stack traces.
 */
export class PayPalError extends Error {
  readonly status: number;
  readonly debugId: string | undefined;
  readonly details: PayPalErrorDetail[];
  readonly method: string;
  readonly path: string;

  constructor(opts: {
    status: number;
    name?: string;
    message: string;
    debugId?: string;
    details?: PayPalErrorDetail[];
    method: string;
    path: string;
    cause?: unknown;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = opts.name ?? "PayPalError";
    this.status = opts.status;
    this.debugId = opts.debugId;
    this.details = opts.details ?? [];
    this.method = opts.method;
    this.path = opts.path;
  }

  get retryable(): boolean {
    return this.status === 0 || RETRYABLE_STATUSES.has(this.status);
  }

  /** The first detail's issue code (e.g. `DISPUTE_NOT_IN_REQUIRED_STATE`), if any. */
  get issue(): string | undefined {
    return this.details[0]?.issue;
  }
}

/** PayPal answered 2xx but the body didn't match our schema. Never retried. */
export class PayPalResponseValidationError extends Error {
  override readonly name = "PayPalResponseValidationError";
  constructor(
    readonly path: string,
    readonly issues: unknown,
  ) {
    super(`Unexpected PayPal response shape from ${path}`);
  }
}

export class EvidenceValidationError extends Error {
  override name = "EvidenceValidationError";
}

/** A file over 10MB, or a submission over 50MB. Thrown before anything is uploaded. */
export class EvidenceTooLargeError extends EvidenceValidationError {
  override name = "EvidenceTooLargeError";
}

export class EvidenceFileTypeError extends EvidenceValidationError {
  override name = "EvidenceFileTypeError";
}

export function isRetryable(err: unknown): boolean {
  return err instanceof PayPalError && err.retryable;
}
