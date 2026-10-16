/**
 * Signed, expiring access to one piece of evidence.
 *
 * The problem this solves: `<img src="…">` **cannot send an Authorization header**. So a plain
 * "require a Bearer token" rule would mean the browser never manages to load the photo at all.
 *
 * Three ways out, and why this one:
 *
 *  1. Put the session token in the query string. Simple, but session tokens then end up in browser
 *     history and server logs -- a long-lived credential leaked for a short-lived need.
 *  2. Cookie auth. Works, but this API is Bearer-based everywhere else, and a cookie path would need
 *     CSRF thinking it currently does not have.
 *  3. **A signature that is only good for one file and only until a deadline.** That is this file.
 *     The URL carries `exp` and `sig`; the signature covers the media id *and* the deadline, so a URL
 *     cannot be edited to point at different evidence, and it stops working on its own.
 *
 * The signature covers the media id, not the storage key: the key is derived from ids the caller
 * already knows, so binding the id is enough, and it keeps the token independent of how blobs happen
 * to be laid out.
 *
 * ⚠️ **The default deadline is the hard cap, not a policy choice.** D8 says evidence is deleted 72
 * hours after upload, so a link to it must not outlive that. A caller may ask for less, never more.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Signature never outlives the evidence. D8's 72 hours is the ceiling. */
export const MAX_SIGNATURE_TTL_MS = 72 * 3_600_000;

/** What the default link is good for: long enough to score a task, short enough to be a leak that expires. */
export const DEFAULT_SIGNATURE_TTL_MS = 6 * 3_600_000;

export interface SignedAccess {
  /** Unix seconds. */
  exp: number;
  /** Hex HMAC-SHA256 over `${mediaId}:${exp}`. */
  sig: string;
}

function payload(mediaId: string, exp: number): string {
  return `${mediaId}:${exp}`;
}

function sign(secret: string, mediaId: string, exp: number): string {
  return createHmac('sha256', secret).update(payload(mediaId, exp)).digest('hex');
}

/**
 * Issue a signature for one piece of evidence.
 *
 * `ttlMs` is clamped to `MAX_SIGNATURE_TTL_MS` rather than rejected: a caller asking for too long is
 * making a mistake about the product's rules, not attacking anything, and returning a valid-but-
 * shorter link is more useful than an error.
 */
export function issueAccess(
  secret: string,
  mediaId: string,
  now: Date,
  ttlMs: number = DEFAULT_SIGNATURE_TTL_MS,
): SignedAccess {
  const bounded = Math.max(0, Math.min(ttlMs, MAX_SIGNATURE_TTL_MS));
  const exp = Math.floor((now.getTime() + bounded) / 1000);
  return { exp, sig: sign(secret, mediaId, exp) };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'malformed' | 'expired' | 'bad_signature' };

/**
 * Check a signature. Order matters for the error message only -- all three failures become the same
 * 404 to the client, but distinguish them here so logs can tell a stale link from a forged one.
 */
export function verifyAccess(
  secret: string,
  mediaId: string,
  access: { exp?: unknown; sig?: unknown },
  now: Date,
): VerifyResult {
  const exp = typeof access.exp === 'number' ? access.exp : Number(access.exp);
  const sig = typeof access.sig === 'string' ? access.sig : '';
  if (!Number.isFinite(exp) || sig === '') return { ok: false, reason: 'malformed' };

  const expected = sign(secret, mediaId, exp);
  // Length check first: `timingSafeEqual` throws on mismatched lengths.
  const sameLength = expected.length === sig.length;
  const matches =
    sameLength && timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(sig, 'utf8'));
  if (!matches) return { ok: false, reason: 'bad_signature' };

  // Expiry is checked AFTER the signature so that an attacker cannot learn whether an id exists by
  // watching which wrong guesses report "expired" rather than "bad signature".
  if (exp * 1000 <= now.getTime()) return { ok: false, reason: 'expired' };

  return { ok: true };
}

/** Append the signature to a URL, preserving any query string that is already there. */
export function withAccess(url: string, access: SignedAccess): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}exp=${access.exp}&sig=${access.sig}`;
}
