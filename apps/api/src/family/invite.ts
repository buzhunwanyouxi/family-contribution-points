/**
 * Invite-code rules for the `family` module (PROJECT_GUIDE A2: "生成家庭邀请码 + 二维码(带有效期)").
 *
 * Everything here is a **pure function**. `PROJECT_GUIDE` does not pin the code format, so the
 * numbers below are this module's defaults, chosen to match the frontend that lane C already
 * shipped (`apps/web/src/pages/FamilySetupPage.tsx` renders `placeholder="例如:8F3K2Q"`,
 * `maxLength={12}` and upper-cases whatever the user types) and to be overridable by environment
 * variable. They are listed as "需要决策" in this round's report rather than buried in the code.
 *
 * Why these constants are not in `packages/shared/src/constants.ts`: that file (and
 * `packages/shared` generally) is a shared file that DAY1-PLAN section 5 freezes for day 1, so
 * lane B keeps its own until the hoisting round. Say so again if you move them.
 */
import { randomInt } from 'node:crypto';
import type { RandomSource } from './types.js';

/**
 * 32 characters, and that number is load-bearing: 32 is a power of two, so `byte & 31` is an
 * **unbiased** index and no rejection sampling is needed.
 *
 * `0` / `O` and `1` / `I` are excluded because a family member will read this code aloud over the
 * phone or retype it from a screenshot. There is no `0` or `1` in the alphabet at all, which also
 * makes the remaining `L` unambiguous.
 */
export const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Six characters -> 32^6 = 887,503,681 codes; comfortably enough for a family app. */
export const INVITE_CODE_LENGTH = 6;

/** A2 asks for an expiry; a week is long enough to get everyone to install the PWA. */
export const DEFAULT_INVITE_TTL_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type EnvBag = Record<string, string | undefined>;

function readEnv(name: string, env?: EnvBag): string | undefined {
  if (env !== undefined) return env[name];
  return (globalThis as { process?: { env?: EnvBag } }).process?.env?.[name];
}

/**
 * `FAMILY_INVITE_TTL_DAYS`, default 7. Kept configurable so a household can decide that invites
 * never linger (Q14 in the guide takes the same stance for the proof-media TTL).
 */
export function resolveInviteTtlDays(env?: EnvBag): number {
  const raw = readEnv('FAMILY_INVITE_TTL_DAYS', env);
  const parsed = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INVITE_TTL_DAYS;
  return parsed;
}

/**
 * A `RandomSource` backed by `node:crypto`. `randomInt(0, 32) / 32` yields exactly `k / 32`, so
 * `floor(x * 32)` recovers `k` with no rounding hazard.
 *
 * Cryptographic randomness matters a little here: a guessable invite code lets a stranger join a
 * family, and the code is the only thing standing between "invited" and "not".
 */
export function createCryptoRandom(): RandomSource {
  return () => randomInt(0, INVITE_ALPHABET.length) / INVITE_ALPHABET.length;
}

/** Encodes one code from an injected random source. Pure, so tests can pin the output. */
export function encodeInviteCode(
  random: RandomSource,
  length: number = INVITE_CODE_LENGTH,
): string {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    const pick = Math.floor(random() * INVITE_ALPHABET.length);
    // `pick` is in range by construction; the fallback keeps this total under `noUncheckedIndexedAccess`.
    code += INVITE_ALPHABET[pick] ?? INVITE_ALPHABET[0];
  }
  return code;
}

/**
 * Turns whatever a human typed into the canonical form, **without** deciding whether it is valid:
 * the frontend already upper-cases, but a user pasting from a chat message may add spaces or
 * hyphens ("8f3-2kq"). Invalid input normalises to something that simply will not be found, which
 * the caller answers with `invalid_invite_code`.
 */
export function normalizeInviteCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\s\-_]/g, '').toUpperCase();
}

/** True when the normalised code has the exact frozen shape. */
export function isWellFormedInviteCode(code: string): boolean {
  if (code.length !== INVITE_CODE_LENGTH) return false;
  for (const char of code) {
    if (!INVITE_ALPHABET.includes(char)) return false;
  }
  return true;
}

/** `inviteExpireAt` for a family created at `now`. */
export function resolveInviteExpiry(now: Date, ttlDays: number = DEFAULT_INVITE_TTL_DAYS): Date {
  return new Date(now.getTime() + ttlDays * MS_PER_DAY);
}

/**
 * `null` means "never expires" (`Family.inviteExpireAt` is nullable). The comparison is `<=`, so a
 * code is dead the instant it reaches its expiry rather than one millisecond later.
 */
export function isInviteExpired(expireAt: Date | null, now: Date): boolean {
  if (expireAt === null) return false;
  return expireAt.getTime() <= now.getTime();
}

/**
 * Draws a code and retries while the repository says it is taken. Bounded, because an unbounded
 * loop on a broken `isTaken` would hang the request instead of failing it.
 *
 * With 8.9e8 codes a collision is already unlikely; the loop exists so that a collision is a
 * non-event rather than a 500 from the `inviteCode @unique` constraint.
 */
export async function generateUniqueInviteCode(
  isTaken: (code: string) => Promise<boolean>,
  random: RandomSource,
  maxAttempts = 5,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = encodeInviteCode(random);
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error(
    `could not generate a unique invite code in ${maxAttempts} attempts -- ` +
      'the repository is probably not checking uniqueness correctly',
  );
}
