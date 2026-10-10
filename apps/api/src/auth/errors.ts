/**
 * Typed auth errors + the single place that decides how a failure looks on the wire.
 *
 * Frozen contract (docs/CONTRACTS.md, "前端调用约定" rule 4):
 *   every failure body is `{ error: string, details?: unknown }`, with semantic HTTP status codes.
 *
 * Reading of that contract, made explicit here (see this round's ops log, section 3):
 *   - `error`   = a STABLE MACHINE CODE (`user_exists`, `invalid_credentials`, ...). This matches the
 *                 existing in-repo precedent (`routes/scoring.ts` answers `invalid_body`).
 *   - `message` = human-readable Chinese, **additive** to the frozen body. The frontend currently
 *                 renders `body.error` directly, which would show `user_exists` to a parent; one line
 *                 in `apps/web/src/api/client.ts` fixes that (`parsed?.message ?? parsed?.error`).
 *   - `details` = structured validation issues.
 *
 * `logReason` is for server logs only and is never serialised, so we can be precise internally
 * ("token_signature_mismatch") while still answering clients with a flat "unauthorized".
 */
export type AuthErrorCode =
  | 'validation_error'
  | 'user_exists'
  | 'invalid_credentials'
  | 'unauthorized'
  | 'not_found'
  | 'internal_error';

const STATUS_BY_CODE: Record<AuthErrorCode, number> = {
  validation_error: 400,
  user_exists: 409,
  invalid_credentials: 401,
  unauthorized: 401,
  not_found: 404,
  internal_error: 500,
};

/** Chinese, user-facing text -- these strings are what a family member actually reads. */
const USER_MESSAGE_BY_CODE: Record<AuthErrorCode, string> = {
  validation_error: '提交的内容不符合要求',
  user_exists: '该手机号或邮箱已注册',
  invalid_credentials: '账号或密码不正确',
  unauthorized: '登录已过期,请重新登录',
  not_found: '找不到该内容',
  internal_error: '服务器出错了,请稍后再试',
};

export interface AuthErrorOptions {
  message?: string;
  /** overrides the per-code Chinese default; use for field-specific guidance */
  userMessage?: string;
  details?: unknown;
  /** internal diagnostics, never sent to the client */
  logReason?: string;
}

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;
  /** Chinese text shown by the UI */
  readonly userMessage: string;
  readonly details?: unknown;
  readonly logReason?: string;

  constructor(code: AuthErrorCode, options: AuthErrorOptions = {}) {
    super(options.message ?? code);
    this.name = 'AuthError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.userMessage = options.userMessage ?? USER_MESSAGE_BY_CODE[code];
    this.details = options.details;
    this.logReason = options.logReason;
  }

  static validation(details?: unknown, userMessage?: string): AuthError {
    return new AuthError('validation_error', {
      message: 'request body failed validation',
      ...(userMessage === undefined ? {} : { userMessage }),
      details,
      logReason: 'validation_error',
    });
  }

  /**
   * Duplicate account. `field` is deliberately NOT echoed to the client: "该手机号或邮箱已注册"
   * is already the most a registration form can usefully say, and echoing the field would confirm
   * which of the two was taken.
   */
  static userExists(field: 'phone' | 'email'): AuthError {
    return new AuthError('user_exists', {
      message: `${field} already registered`,
      logReason: `duplicate_${field}`,
    });
  }

  /**
   * Same error for "unknown account" and "wrong password" on purpose: anything else would let a
   * client enumerate which phone numbers are registered.
   */
  static invalidCredentials(logReason = 'bad_credentials'): AuthError {
    return new AuthError('invalid_credentials', {
      message: 'account or password is incorrect',
      logReason,
    });
  }

  static unauthorized(logReason = 'unauthorized'): AuthError {
    return new AuthError('unauthorized', {
      message: 'authentication required',
      logReason,
    });
  }

  static notFound(logReason = 'not_found'): AuthError {
    return new AuthError('not_found', { message: 'not found', logReason });
  }
}

export interface ErrorBody {
  /** stable machine code, e.g. `user_exists` */
  error: string;
  /** human-readable Chinese for the UI */
  message: string;
  details?: unknown;
}

/** Map anything thrown by the auth module onto an HTTP status + contract-shaped body. */
export function toErrorBody(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof AuthError) {
    const body: ErrorBody = { error: error.code, message: error.userMessage };
    if (error.details !== undefined) body.details = error.details;
    return { status: error.status, body };
  }
  return {
    status: 500,
    body: {
      error: 'internal_error',
      message: '服务器出错了,请稍后再试',
    },
  };
}
