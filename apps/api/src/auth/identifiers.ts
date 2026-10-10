/**
 * `account` normalisation for the auth endpoints (CONTRACTS #3/#4).
 *
 * The frozen contract is a SINGLE field, `account`, that accepts a phone number or an email address;
 * the backend decides which ("账号:一个字段同时接受手机号与邮箱,由后端判断"). So the parsing lives
 * here rather than in the request schema -- the HTTP layer must not force the client to say which
 * kind it is sending.
 *
 * Normalising on the way IN is also what makes the DB unique indexes behave case-insensitively and
 * separator-insensitively: we always store lower-cased emails and digits-only phone numbers, so
 * `Dad@Example.com` and `dad@example.com` cannot both exist.
 *
 * Anything that cannot be normalised returns `null` and becomes a validation error -- the auth
 * module never stores a "sort of a phone number".
 */

/**
 * Length bounds for a normalised phone number (digits only).
 * PROJECT_GUIDE A1 says "手机号或邮箱" without fixing a format; keeping it digit-count based avoids
 * hard-coding one country's mobile prefix. Flagged for human confirmation in this round's ops log.
 */
export const PHONE_MIN_DIGITS = 6;
export const PHONE_MAX_DIGITS = 20;

export const EMAIL_MAX_LENGTH = 254;

/** Deliberately permissive: shape check only, the real proof is a verification mail later. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const SEPARATORS = /[\s\-().]/g;

/**
 * `+86 138-0013-8000` -> `13800138000`
 * Returns null when the input is not plausibly a phone number.
 */
export function normalizePhone(raw: string): string | null {
  let value = raw.trim().replace(SEPARATORS, '');
  if (value.startsWith('+')) value = value.slice(1);
  if (!/^\d+$/.test(value)) return null;

  // drop a country code typed in front of a mainland mobile number
  if (value.length === 13 && value.startsWith('86') && value[2] === '1') {
    value = value.slice(2);
  }

  if (value.length < PHONE_MIN_DIGITS || value.length > PHONE_MAX_DIGITS) return null;
  return value;
}

/** `  Dad@Example.COM ` -> `dad@example.com`; null when it is not an email address. */
export function normalizeEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (value.length === 0 || value.length > EMAIL_MAX_LENGTH) return null;
  if (!EMAIL_PATTERN.test(value)) return null;
  return value;
}

export type AccountKind = 'phone' | 'email';

/**
 * Decide phone-vs-email for the single `account` field. An `@` is the discriminator, exactly as
 * lane C's mock does it (`findUserByAccount` in apps/web/src/api/mock.ts).
 */
export function detectAccountKind(raw: string): AccountKind {
  return raw.includes('@') ? 'email' : 'phone';
}

export function normalizeAccount(raw: string): { kind: AccountKind; value: string } | null {
  const kind = detectAccountKind(raw);
  const value = kind === 'email' ? normalizeEmail(raw) : normalizePhone(raw);
  if (value === null) return null;
  return { kind, value };
}

/**
 * Nicknames are shown next to every task, so they are trimmed and length-bounded.
 * The UI caps input at 12 characters; the backend accepts up to 24 so a longer name coming from
 * another client is not a hard failure.
 */
export const NICKNAME_MIN_LENGTH = 1;
export const NICKNAME_MAX_LENGTH = 24;

export function normalizeNickname(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length < NICKNAME_MIN_LENGTH || value.length > NICKNAME_MAX_LENGTH) return null;
  return value;
}
