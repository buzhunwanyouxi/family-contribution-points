/**
 * Password hashing.
 *
 * PROJECT_GUIDE ch.10 requires a real password KDF. DAY1-PLAN section 6 forbids adding dependencies
 * on day 1. `node:crypto.scrypt` is a memory-hard KDF in the standard library, so it satisfies both
 * requirements at once -- no new package, no plaintext, no home-made crypto primitives.
 *
 * Swap-in seam: implement `PasswordHasher` and call `registerHasher()`; `register.ts` and `login.ts`
 * never change. That is how bcrypt/argon2 gets added later without touching the use-cases.
 *
 * Stored format -- scheme-tagged so several schemes can coexist in the same table:
 *
 *   scrypt$<N>$<r>$<p>$<saltBase64url>$<hashBase64url>
 *
 * bcrypt rows keep their own `$2a$`/`$2b$` prefix, which is exactly why the scheme tag is the
 * first segment: `hashSchemeOf()` can tell them apart without guessing.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Minimum length is **6**, not 8.
 *
 * Why: the frozen client already shipped that rule -- `apps/web/src/pages/LoginPage.tsx` has
 * `minLength={6}` / placeholder "至少 6 位", and lane C's mock rejects anything shorter with
 * "密码至少 6 位". A backend floor of 8 would make the first registration attempt from the shipped
 * UI fail with a confusing 400. Contract first, so we align to 6.
 *
 * ⚠️ Security note for the human owner: 6 is weak. Raising it to 8+ is a one-line change here
 * (`PASSWORD_MIN_LENGTH`) **plus** the matching `minLength` in LoginPage. Recorded in this round's
 * report as a decision item, not changed unilaterally.
 */
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;

export const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keylen: 64,
  saltBytes: 16,
} as const;

const SCRYPT_SCHEME = 'scrypt';

export interface PasswordHasher {
  /** first segment of the stored string, e.g. `scrypt` */
  readonly scheme: string;
  hash(plain: string): Promise<string>;
  verify(plain: string, stored: string): Promise<boolean>;
  /** true when `stored` was produced by this scheme */
  matches(stored: string): boolean;
}

function scryptAsync(
  plain: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plain, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const scryptHasher: PasswordHasher = {
  scheme: SCRYPT_SCHEME,

  async hash(plain: string): Promise<string> {
    const salt = randomBytes(SCRYPT_PARAMS.saltBytes);
    const derived = await scryptAsync(plain, salt, SCRYPT_PARAMS.keylen, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
    });
    return [
      SCRYPT_SCHEME,
      SCRYPT_PARAMS.N,
      SCRYPT_PARAMS.r,
      SCRYPT_PARAMS.p,
      salt.toString('base64url'),
      derived.toString('base64url'),
    ].join('$');
  },

  async verify(plain: string, stored: string): Promise<boolean> {
    const parsed = parseScryptHash(stored);
    if (parsed === null) return false;
    const derived = await scryptAsync(plain, parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
    });
    return safeEqual(derived, parsed.hash);
  },

  matches(stored: string): boolean {
    return hashSchemeOf(stored) === SCRYPT_SCHEME;
  },
};

interface ParsedScryptHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parseScryptHash(stored: string): ParsedScryptHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6) return null;
  const [scheme, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  if (
    scheme !== SCRYPT_SCHEME ||
    rawN === undefined ||
    rawR === undefined ||
    rawP === undefined ||
    rawSalt === undefined ||
    rawHash === undefined
  ) {
    return null;
  }
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N <= 1 || r <= 0 || p <= 0) return null;
  const salt = Buffer.from(rawSalt, 'base64url');
  const hash = Buffer.from(rawHash, 'base64url');
  if (salt.length === 0 || hash.length === 0) return null;
  return { N, r, p, salt, hash };
}

/* ------------------------------------------------------------------------------------------------
 * scheme registry
 * ---------------------------------------------------------------------------------------------- */

const registry = new Map<string, PasswordHasher>();

/** Throws on a duplicate scheme so a second AI cannot silently shadow an existing implementation. */
export function registerHasher(hasher: PasswordHasher): void {
  if (registry.has(hasher.scheme)) {
    throw new Error(`password scheme already registered: ${hasher.scheme}`);
  }
  registry.set(hasher.scheme, hasher);
}

registerHasher(scryptHasher);

export function hasHasher(scheme: string): boolean {
  return registry.has(scheme);
}

/** `scrypt$...` -> `scrypt`; bcrypt `$2b$...` -> `bcrypt`; malformed -> null */
export function hashSchemeOf(stored: string): string | null {
  if (stored.length === 0) return null;
  if (stored.startsWith('$2')) return 'bcrypt';
  const scheme = stored.split('$')[0];
  if (scheme === undefined || scheme.length === 0) return null;
  return scheme;
}

export async function hashPassword(plain: string, scheme: string = SCRYPT_SCHEME): Promise<string> {
  const hasher = registry.get(scheme);
  if (hasher === undefined) throw new Error(`unknown password scheme: ${scheme}`);
  assertPasswordPolicy(plain);
  return hasher.hash(plain);
}

/**
 * Returns false for a malformed hash or a scheme without a registered hasher.
 *
 * KNOWN LIMITATION (logged in this round's ops log): a bcrypt row would fail here until a bcrypt
 * hasher is registered, and the user would see a plain 401. Register the hasher BEFORE the first
 * bcrypt row is written -- `hasHasher('bcrypt')` is the check to assert in that migration.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const scheme = hashSchemeOf(stored);
  if (scheme === null) return false;
  const hasher = registry.get(scheme);
  if (hasher === undefined) return false;
  if (plain.length === 0) return false;
  return hasher.verify(plain, stored);
}

/** Password policy; throws a `RangeError` so callers can translate it into a validation error. */
export function assertPasswordPolicy(plain: string): void {
  if (plain.length < PASSWORD_MIN_LENGTH) {
    throw new RangeError(`password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (plain.length > PASSWORD_MAX_LENGTH) {
    throw new RangeError(`password must be at most ${PASSWORD_MAX_LENGTH} characters`);
  }
}

export function isPasswordAcceptable(plain: string): boolean {
  return plain.length >= PASSWORD_MIN_LENGTH && plain.length <= PASSWORD_MAX_LENGTH;
}
