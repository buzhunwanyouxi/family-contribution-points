/**
 * Errors for the instances module. Same frozen body as every other module:
 * `{error, message?, details?}`, where `error` is a stable machine code and `message` is Chinese text
 * a family member can read as-is.
 *
 * The interesting one is `invalid_status_transition`. It exists because the alternative -- returning
 * 400 "bad request" -- tells a client nothing about *why* it failed, and the most likely cause
 * (somebody else already claimed / already settled) is a situation the UI must handle differently from
 * a malformed request.
 */
export type InstanceErrorCode =
  | 'validation_error'
  | 'not_a_member'
  | 'instance_not_found'
  | 'invalid_status_transition'
  | 'already_claimed'
  | 'not_the_claimer';

export interface ErrorBody {
  error: string;
  message?: string;
  details?: unknown;
}

interface InstanceErrorOptions {
  message: string;
  status: number;
  details?: unknown;
  /** short, non-user-facing tag for logs (never sent to the client) */
  logReason?: string;
}

export class InstanceError extends Error {
  readonly code: InstanceErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly logReason: string | undefined;

  constructor(code: InstanceErrorCode, options: InstanceErrorOptions) {
    super(options.message);
    this.name = 'InstanceError';
    this.code = code;
    this.status = options.status;
    this.details = options.details;
    this.logReason = options.logReason;
  }

  static validation(details?: unknown): InstanceError {
    return new InstanceError('validation_error', {
      status: 400,
      message: '请求内容不符合要求,请检查后重试',
      details,
      logReason: 'validation_failed',
    });
  }

  /** Same 403 as an unknown family, so `:fid` cannot be probed (see CONTRACTS #15). */
  static notAMember(): InstanceError {
    return new InstanceError('not_a_member', {
      status: 403,
      message: '你不是这个家庭的成员',
      logReason: 'not_a_member',
    });
  }

  /**
   * No such instance, or it belongs to another family.
   *
   * **One answer for both on purpose**: distinguishing them would let a caller discover which instance
   * ids exist in families they are not in.
   */
  static notFound(): InstanceError {
    return new InstanceError('instance_not_found', {
      status: 404,
      message: '找不到这个任务,可能已被删除',
      logReason: 'instance_not_found',
    });
  }

  /**
   * The requested transition is not in the state machine (CONTRACTS #16/#17).
   *
   * 409 rather than 400: the request was well-formed, the *state* refused it. That is also what a
   * double-tap on a button looks like, and the UI should re-read rather than re-submit.
   */
  static invalidTransition(from: string, to: string): InstanceError {
    return new InstanceError('invalid_status_transition', {
      status: 409,
      message: '这个任务的状态已经变了,请刷新后重试',
      details: { from, to },
      logReason: 'invalid_status_transition',
    });
  }

  /** D1: somebody else got it first. Distinct from `invalidTransition` so the UI can say so. */
  static alreadyClaimed(): InstanceError {
    return new InstanceError('already_claimed', {
      status: 409,
      message: '这个任务已经被别人接了',
      logReason: 'already_claimed',
    });
  }

  /** Only the claimer may start / submit / release their own instance. */
  static notTheClaimer(): InstanceError {
    return new InstanceError('not_the_claimer', {
      status: 403,
      message: '这个任务不是你接的,不能操作',
      logReason: 'not_the_claimer',
    });
  }
}
