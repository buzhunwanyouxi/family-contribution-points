/**
 * Access tokens: HS256, implemented on `node:crypto` only.
 *
 * DAY1-PLAN section 6 forbids adding packages on day 1, and `.env.example` already reserves
 * `JWT_SECRET`, so the token format is the standard compact JWS: `base64url(header).base64url(
 * payload).base64url(HMAC-SHA256)`. No exotic crypto: HMAC-SHA256 is exactly what HS256 is.
 *
 * Swap-in seam: `TokenCodec` (types.ts). To move to `jose`/`jsonwebtoken` later, implement that
 * interface and hand it to `createAuthService({ tokens })` -- no route, use-case or test changes.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuthError } from './errors.js';
import type { IssuedToken, JwtConfig, TokenCodec, TokenPayload } from './types.js';

const ALG = 'HS256';
const JWT_TYPE = 'JWT';

export const DEFAULT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_CLOCK_TOLERANCE_SECONDS = 60;
export const DEFAULT_ISSUER = 'fcp-api';

/** Used only outside production; makes `pnpm dev` work before anyone copies `.env.example`. */
export const DEV_JWT_SECRET_FALLBACK = 'fcp-dev-only-secret-not-for-production';

/** The literal value shipped in `.env.example` -- treated as "not configured" on purpose. */
export const INSECURE_EXAMPLE_SECRET = 'change-me-in-production';

export type JwtSecretSource = 'env' | 'dev-fallback';

export interface ResolvedJwtSecret {
  secret: string;
  source: JwtSecretSource;
}

function readProcessEnv(): Record<string, string | undefined> {
  return (
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  );
}

/**
 * Fail closed in production, convenient in development.
 *
 * A placeholder secret must never survive into production: with a known HMAC key anyone can mint a
 * token for any user id. So production throws instead of warning (PROJECT_GUIDE ch.10).
 */
export function resolveJwtSecret(env: Record<string, string | undefined> = readProcessEnv()): ResolvedJwtSecret {
  const raw = env.JWT_SECRET?.trim();
  const usable = raw !== undefined && raw.length > 0 && raw !== INSECURE_EXAMPLE_SECRET;
  if (usable && raw !== undefined) return { secret: raw, source: 'env' };

  if ((env.NODE_ENV ?? '').trim() === 'production') {
    throw new Error(
      'JWT_SECRET is not configured (or is still the .env.example placeholder). ' +
        'Set a strong random value before starting in production.',
    );
  }
  return { secret: DEV_JWT_SECRET_FALLBACK, source: 'dev-fallback' };
}

export function resolveTokenTtlSeconds(
  env: Record<string, string | undefined> = readProcessEnv(),
): number {
  const raw = env.JWT_TTL_SECONDS;
  if (raw === undefined) return DEFAULT_TOKEN_TTL_SECONDS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TOKEN_TTL_SECONDS;
}

export function buildJwtConfig(overrides: Partial<JwtConfig> = {}): JwtConfig {
  const resolved = overrides.secret === undefined ? resolveJwtSecret() : null;
  const secret = overrides.secret ?? resolved?.secret ?? DEV_JWT_SECRET_FALLBACK;
  return {
    secret,
    ttlSeconds: overrides.ttlSeconds ?? resolveTokenTtlSeconds(),
    issuer: overrides.issuer ?? DEFAULT_ISSUER,
    clockToleranceSeconds: overrides.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS,
    ...(overrides.nowSeconds === undefined ? {} : { nowSeconds: overrides.nowSeconds }),
  };
}

function base64UrlEncode(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function base64UrlDecodeJson(part: string): unknown {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
}

function sign(signingInput: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(signingInput, 'utf8').digest();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createHs256Codec(config: JwtConfig): TokenCodec {
  if (config.secret.length === 0) {
    throw new Error('refusing to create an HS256 codec without a secret');
  }

  const nowSeconds = config.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  function issue(subject: string): IssuedToken {
    if (typeof subject !== 'string' || subject.length === 0) {
      throw AuthError.unauthorized('issue_without_subject');
    }
    const issuedAt = nowSeconds();
    const expiresAt = issuedAt + config.ttlSeconds;
    const payload: TokenPayload = {
      sub: subject,
      iat: issuedAt,
      exp: expiresAt,
      typ: 'access',
      iss: config.issuer,
    };
    const header = base64UrlEncode({ alg: ALG, typ: JWT_TYPE });
    const body = base64UrlEncode(payload);
    const signingInput = `${header}.${body}`;
    const signature = sign(signingInput, config.secret).toString('base64url');
    return {
      token: `${signingInput}.${signature}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      expiresIn: config.ttlSeconds,
    };
  }

  function verifyToken(token: string): TokenPayload {
    if (typeof token !== 'string' || token.length === 0) {
      throw AuthError.unauthorized('empty_token');
    }

    const parts = token.split('.');
    const headerPart = parts[0];
    const payloadPart = parts[1];
    const signaturePart = parts[2];
    if (parts.length !== 3 || headerPart === undefined || payloadPart === undefined || signaturePart === undefined) {
      throw AuthError.unauthorized('malformed_token');
    }

    // Reject `alg: none` and every other algorithm before trusting anything inside the token.
    let header: unknown;
    try {
      header = base64UrlDecodeJson(headerPart);
    } catch {
      throw AuthError.unauthorized('undecodable_header');
    }
    if (!isRecord(header) || header.alg !== ALG || header.typ !== JWT_TYPE) {
      throw AuthError.unauthorized('unsupported_alg');
    }

    const expected = sign(`${headerPart}.${payloadPart}`, config.secret);
    const actual = Buffer.from(signaturePart, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw AuthError.unauthorized('token_signature_mismatch');
    }

    let payload: unknown;
    try {
      payload = base64UrlDecodeJson(payloadPart);
    } catch {
      throw AuthError.unauthorized('undecodable_payload');
    }
    if (!isRecord(payload)) throw AuthError.unauthorized('malformed_payload');

    const { sub, iat, exp, typ, iss } = payload;
    if (typeof sub !== 'string' || sub.length === 0) throw AuthError.unauthorized('missing_sub');
    if (typeof iat !== 'number' || !Number.isFinite(iat)) throw AuthError.unauthorized('missing_iat');
    if (typeof exp !== 'number' || !Number.isFinite(exp)) throw AuthError.unauthorized('missing_exp');
    if (typ !== 'access') throw AuthError.unauthorized('wrong_token_type');
    if (iss !== config.issuer) throw AuthError.unauthorized('issuer_mismatch');

    const now = nowSeconds();
    const tolerance = config.clockToleranceSeconds;
    if (now > exp + tolerance) throw AuthError.unauthorized('token_expired');
    if (iat > now + tolerance) throw AuthError.unauthorized('token_from_the_future');

    return { sub, iat, exp, typ: 'access', iss: config.issuer };
  }

  return { issue, verifyToken };
}
