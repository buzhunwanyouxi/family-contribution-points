/**
 * The single error shape for this module.
 *
 * CONTRACTS section 2 rule 4 freezes the body as `{error, message?, details?}` where
 *   - `error`   is a **stable machine code** the client branches on, and
 *   - `message` is **Chinese text that can be shown to a family member as-is**.
 *
 * Both fields are always produced here, so a handler can never accidentally hand the browser a
 * raw `not_a_member` string (which is exactly the bug lane A found and lane C fixed on `main`).
 */
export type FamilyErrorCode =
  | 'validation_error'
  | 'invalid_invite_code'
  | 'invite_expired'
  | 'not_a_member'
  | 'user_not_found';

export interface ErrorBody {
  error: string;
  message?: string;
  details?: unknown;
}

interface FamilyErrorOptions {
  message: string;
  status: number;
  details?: unknown;
  /** short, non-user-facing tag for logs (never sent to the client) */
  logReason?: string;
}

export class FamilyError extends Error {
  readonly code: FamilyErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly logReason: string | undefined;

  constructor(code: FamilyErrorCode, options: FamilyErrorOptions) {
    super(options.message);
    this.name = 'FamilyError';
    this.code = code;
    this.status = options.status;
    this.details = options.details;
    this.logReason = options.logReason;
  }

  /** Shape check failed (zod) or a field broke a documented rule. */
  static validation(details?: unknown): FamilyError {
    return new FamilyError('validation_error', {
      status: 400,
      message: '请求内容不符合要求,请检查后重试',
      details,
      logReason: 'validation',
    });
  }

  /** The code does not exist at all -- either it was mistyped or the family rotated it. */
  static invalidInviteCode(): FamilyError {
    return new FamilyError('invalid_invite_code', {
      status: 404,
      message: '邀请码不存在,请向家人确认后重新输入',
      logReason: 'invite_code_not_found',
    });
  }

  /** The code exists but its `inviteExpireAt` has passed (CONTRACTS #6/#7 / PROJECT_GUIDE A2). */
  static inviteExpired(): FamilyError {
    return new FamilyError('invite_expired', {
      status: 400,
      message: '这个邀请码已经过期了,请让家人重新生成一个',
      logReason: 'invite_code_expired',
    });
  }

  /**
   * The caller is not a member of `:fid`.
   *
   * A non-existent family deliberately answers the SAME way (403, not 404) so that a stranger
   * cannot probe which family ids exist by comparing status codes. CONTRACTS says
   * "跨家庭访问一律 403", and this is the reading that keeps that promise for unknown ids too.
   */
  static notAMember(): FamilyError {
    return new FamilyError('not_a_member', {
      status: 403,
      message: '你不是这个家庭的成员',
      logReason: 'not_a_member',
    });
  }

  /** The verified token points at a user row that no longer exists. */
  static userNotFound(): FamilyError {
    return new FamilyError('user_not_found', {
      status: 404,
      message: '账号不存在,请重新登录',
      logReason: 'user_not_found',
    });
  }
}

/**
 * Maps any thrown value onto `{status, body}`. Unknown errors become a generic 500 whose `message`
 * is user-safe -- the real cause goes to the log, never to the response.
 */
export function toErrorBody(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof FamilyError) {
    const body: ErrorBody = { error: error.code, message: error.message };
    if (error.details !== undefined) body.details = error.details;
    return { status: error.status, body };
  }
  return {
    status: 500,
    body: { error: 'internal_error', message: '服务器开小差了,请稍后再试' },
  };
}
