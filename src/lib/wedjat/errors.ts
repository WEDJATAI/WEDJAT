// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Typed error taxonomy (§60).
//
// WHY: every module throws categorized errors so API handlers can map them to
// safe user-facing messages without leaking stack traces (§60) and so retry /
// failover logic can distinguish transient vs permanent failures (§22).
// ═══════════════════════════════════════════════════════════════════════════════

export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DATABASE'
  | 'RATE_LIMITED'
  | 'BUDGET_EXCEEDED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'RETRIEVAL'
  | 'INFERENCE'
  | 'TRAINING'
  | 'MODEL'
  | 'ARTIFACT'
  | 'POLICY'
  | 'INTERNAL';

/** Transient errors are retryable (§22). Permanent ones never are. */
const TRANSIENT_CODES: Set<ErrorCode> = new Set([
  'TIMEOUT',
  'PROVIDER_UNAVAILABLE',
]);

export class WedjatError extends Error {
  readonly code: ErrorCode;
  readonly transient: boolean;
  readonly retryable: boolean;
  readonly httpStatus: number;
  readonly detail?: string;

  constructor(
    code: ErrorCode,
    message: string,
    opts: {
      transient?: boolean;
      httpStatus?: number;
      detail?: string;
      retryable?: boolean;
    } = {}
  ) {
    super(message);
    this.name = 'WedjatError';
    this.code = code;
    // Transiency: explicit override wins, otherwise the code default applies.
    this.transient = opts.transient ?? TRANSIENT_CODES.has(code);
    this.retryable = opts.retryable ?? this.transient;
    this.httpStatus = opts.httpStatus ?? statusFor(code);
    this.detail = opts.detail;
  }
}

function statusFor(code: ErrorCode): number {
  switch (code) {
    case 'VALIDATION':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
    case 'POLICY':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
      return 409;
    case 'RATE_LIMITED':
      return 429;
    case 'BUDGET_EXCEEDED':
      return 429;
    case 'TIMEOUT':
      return 504;
    default:
      return 500;
  }
}

/** Wraps unknown throws into a typed INTERNAL error. */
export function toWedjatError(err: unknown): WedjatError {
  if (err instanceof WedjatError) return err;
  const message = err instanceof Error ? err.message : 'Unknown error';
  return new WedjatError('INTERNAL', message, { detail: String(err) });
}
