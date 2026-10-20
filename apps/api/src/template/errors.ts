/**
 * The single error shape for the `template` module.
 *
 * CONTRACTS section 2 rule 4 freezes the body as `{error, message?, details?}`, where `error` is a
 * stable machine code and `message` is Chinese text a family member can read as-is. Producing both
 * here is what stops a handler from ever handing the browser a raw `not_owner` string -- the exact
 * bug lane A found in its own module and lane C fixed on `main` (see PR #1 review).
 *
 * `logReason` never leaves the server: it is the precise internal tag, while `message` is the
 * coarse, safe one.
 */
export type TemplateErrorCode =
  | 'validation_error'
  | 'invalid_repeat_rule'
  | 'not_a_member'
  | 'not_owner'
  | 'template_not_found'
  | 'invalid_status_transition';

export interface ErrorBody {
  error: string;
  message?: string;
  details?: unknown;
}

interface TemplateErrorOptions {
  message: string;
  status: number;
  details?: unknown;
  /** short, non-user-facing tag for logs (never sent to the client) */
  logReason?: string;
}

export class TemplateError extends Error {
  readonly code: TemplateErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly logReason: string | undefined;

  constructor(code: TemplateErrorCode, options: TemplateErrorOptions) {
    super(options.message);
    this.name = 'TemplateError';
    this.code = code;
    this.status = options.status;
    this.details = options.details;
    this.logReason = options.logReason;
  }

  /** A field broke a documented rule (B2 maxPoints, timeOfDay format, ...). */
  static validation(details?: unknown): TemplateError {
    return new TemplateError('validation_error', {
      status: 400,
      message: '固定任务的内容不符合要求,请检查后重试',
      details,
      logReason: 'validation',
    });
  }

  /**
   * `repeatRule` is not one of `daily` / `weekly:...` / `monthly:...`.
   *
   * A separate code from `validation_error` on purpose: the client can re-open the repeat picker
   * with a precise hint instead of highlighting every field. It is still a 400: nothing was missing
   * from the request, the value itself is unusable.
   */
  static invalidRepeatRule(raw: unknown): TemplateError {
    return new TemplateError('invalid_repeat_rule', {
      status: 400,
      message: '重复规则不对:请选"每天"、"每周几"(1-7,7 是周日)或"每月几号"(1-31)',
      details: { repeatRule: raw },
      logReason: 'invalid_repeat_rule',
    });
  }

  /**
   * The caller is not a member of `:fid`.
   *
   * An unknown family answers the SAME way (403, not 404) so a stranger cannot probe which family
   * ids exist -- the reading of "跨家庭访问一律 403" that also covers unknown ids.
   */
  static notAMember(): TemplateError {
    return new TemplateError('not_a_member', {
      status: 403,
      message: '你不是这个家庭的成员',
      logReason: 'not_a_member',
    });
  }

  /**
   * The caller IS in the family but is not its owner (B1: 仅创始人可创建固定任务).
   *
   * Distinct from `not_a_member` for the same reason lane B separated `role_not_allowed`: telling a
   * child they are "not a member of this family" when they tap "add a chore" is false and alarming.
   * Both are 403 with no detail about the family, so nothing leaks to a stranger.
   */
  static notOwner(): TemplateError {
    return new TemplateError('not_owner', {
      status: 403,
      message: '只有家庭创建者可以设置固定任务',
      logReason: 'not_owner',
    });
  }

  /** No template with that id in that family -- possibly deleted by another owner session. */
  static templateNotFound(): TemplateError {
    return new TemplateError('template_not_found', {
      status: 404,
      message: '这个固定任务不存在,可能已经被删除了',
      logReason: 'template_not_found',
    });
  }

  /** A status change M2 does not allow (e.g. trying to move a template to `archived`). */
  static invalidStatusTransition(from: string, to: string): TemplateError {
    return new TemplateError('invalid_status_transition', {
      status: 400,
      message: '这个固定任务当前的状态不支持该操作',
      details: { from, to },
      logReason: 'invalid_status_transition',
    });
  }
}

/**
 * Maps any thrown value onto `{status, body}`. Unknown errors become a generic 500 whose `message`
 * is user-safe -- the real cause goes to the log, never to the response.
 */
export function toErrorBody(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof TemplateError) {
    const body: ErrorBody = { error: error.code, message: error.message };
    if (error.details !== undefined) body.details = error.details;
    return { status: error.status, body };
  }
  return {
    status: 500,
    body: { error: 'internal_error', message: '服务器开小差了,请稍后再试' },
  };
}
