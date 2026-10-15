/**
 * Errors for proof-media upload. Same frozen body as every other module:
 * `{error, message?, details?}` where `error` is a stable machine code and `message` is Chinese text
 * that can be shown to a family member as-is (CONTRACTS section 2 rule 4).
 *
 * Codes are chosen to be *actionable by the client*: the frontend can tell "too big" (offer to
 * compress) from "wrong type" (offer the camera) from "already expired" (tell the user to re-shoot).
 * A single `validation_error` for all four would force the UI to guess.
 */
export type MediaErrorCode =
  | 'validation_error'
  | 'not_a_member'
  | 'instance_not_found'
  | 'instance_already_settled'
  | 'unsupported_media'
  | 'media_too_large'
  | 'no_file';

export interface ErrorBody {
  error: string;
  message?: string;
  details?: unknown;
}

interface MediaErrorOptions {
  message: string;
  status: number;
  details?: unknown;
  /** short, non-user-facing tag for logs (never sent to the client) */
  logReason?: string;
}

export class MediaError extends Error {
  readonly code: MediaErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly logReason: string | undefined;

  constructor(code: MediaErrorCode, options: MediaErrorOptions) {
    super(options.message);
    this.name = 'MediaError';
    this.code = code;
    this.status = options.status;
    this.details = options.details;
    this.logReason = options.logReason;
  }

  /** Malformed request: missing part, bad field, unknown instance id shape. */
  static validation(details?: unknown): MediaError {
    return new MediaError('validation_error', {
      status: 400,
      message: '请求内容不符合要求,请检查后重试',
      details,
      logReason: 'validation_failed',
    });
  }

  /** No file part at all -- distinct from "the file is bad", because the fix is different. */
  static noFile(): MediaError {
    return new MediaError('no_file', {
      status: 400,
      message: '没有收到文件,请重新选择照片或视频',
      logReason: 'missing_file_part',
    });
  }

  /** Same 403 as an unknown family, so `:fid` cannot be probed (CONTRACTS section 2). */
  static notAMember(): MediaError {
    return new MediaError('not_a_member', {
      status: 403,
      message: '你不是这个家庭的成员',
      logReason: 'not_a_member',
    });
  }

  /** The instance exists but belongs to another family, or does not exist at all. Same answer. */
  static instanceNotFound(): MediaError {
    return new MediaError('instance_not_found', {
      status: 404,
      message: '找不到这个任务,可能已被删除',
      logReason: 'instance_not_found',
    });
  }

  /**
   * Evidence for a settled task is closed.
   *
   * D8/E14: the 72-hour deletion must not block scoring, but the reverse direction is different --
   * once the task is settled, the points are already awarded, and attaching new evidence afterwards
   * would let someone change the basis of a decision that has been made. The user-visible message
   * says what to do instead of just refusing.
   */
  static instanceSettled(): MediaError {
    return new MediaError('instance_already_settled', {
      status: 409,
      message: '这个任务已经结算了,不能再补证据;如有疑问请让家长处理',
      logReason: 'instance_already_settled',
    });
  }

  static unsupportedMedia(details?: unknown): MediaError {
    return new MediaError('unsupported_media', {
      status: 415,
      message: '只支持照片(JPG/PNG/WebP/HEIC)或视频(MP4/MOV/WebM)',
      details,
      logReason: 'unsupported_media',
    });
  }

  static tooLarge(message: string, details?: unknown): MediaError {
    return new MediaError('media_too_large', {
      status: 413,
      message,
      details,
      logReason: 'media_too_large',
    });
  }
}
