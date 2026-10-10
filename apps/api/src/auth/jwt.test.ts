import { describe, expect, it } from 'vitest';
import { AuthError } from './errors.js';
import {
  DEFAULT_ISSUER,
  DEV_JWT_SECRET_FALLBACK,
  INSECURE_EXAMPLE_SECRET,
  buildJwtConfig,
  createHs256Codec,
  resolveJwtSecret,
  resolveTokenTtlSeconds,
} from './jwt.js';
import type { JwtConfig } from './types.js';

function codec(overrides: Partial<JwtConfig> = {}) {
  return createHs256Codec({
    secret: 'test-secret',
    ttlSeconds: 3600,
    issuer: DEFAULT_ISSUER,
    clockToleranceSeconds: 0,
    ...overrides,
  });
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe('HS256 token codec', () => {
  it('round-trips a subject and reports the expiry', () => {
    const now = 1_700_000_000;
    const issued = codec({ nowSeconds: () => now }).issue('user-1');
    expect(issued.expiresIn).toBe(3600);
    expect(issued.expiresAt).toBe(new Date((now + 3600) * 1000).toISOString());
    expect(issued.token.split('.')).toHaveLength(3);

    const payload = codec({ nowSeconds: () => now }).verifyToken(issued.token);
    expect(payload.sub).toBe('user-1');
    expect(payload.exp).toBe(now + 3600);
    expect(payload.typ).toBe('access');
    expect(payload.iss).toBe(DEFAULT_ISSUER);
  });

  it('rejects a token signed with a different secret', () => {
    const token = codec({ secret: 'secret-a' }).issue('user-1').token;
    expect(() => codec({ secret: 'secret-b' }).verifyToken(token)).toThrow(AuthError);
  });

  it('rejects an expired token', () => {
    let now = 1_700_000_000;
    const token = codec({ nowSeconds: () => now, ttlSeconds: 60 }).issue('user-1').token;
    now += 61;
    expect(() => codec({ nowSeconds: () => now, ttlSeconds: 60 }).verifyToken(token)).toThrow(/unauthorized|authentication/);
  });

  it('honours the clock tolerance so small skew does not log everyone out', () => {
    let now = 1_700_000_000;
    const token = codec({ nowSeconds: () => now, ttlSeconds: 60, clockToleranceSeconds: 300 })
      .issue('user-1').token;
    now += 120;
    expect(
      codec({ nowSeconds: () => now, ttlSeconds: 60, clockToleranceSeconds: 300 }).verifyToken(token).sub,
    ).toBe('user-1');
  });

  it('rejects a tampered payload even though the header is unchanged', () => {
    const now = 1_700_000_000;
    const token = codec({ nowSeconds: () => now }).issue('user-1').token;
    const [header, , signature] = token.split('.');
    const forgedPayload = base64url({ sub: 'user-2', iat: now, exp: now + 3600, typ: 'access', iss: DEFAULT_ISSUER });
    const forged = `${header}.${forgedPayload}.${signature}`;
    expect(() => codec({ nowSeconds: () => now }).verifyToken(forged)).toThrow(AuthError);
  });

  it("rejects alg: none instead of trusting the payload", () => {
    const now = 1_700_000_000;
    const header = base64url({ alg: 'none', typ: 'JWT' });
    const payload = base64url({ sub: 'attacker', iat: now, exp: now + 3600, typ: 'access', iss: DEFAULT_ISSUER });
    expect(() => codec({ nowSeconds: () => now }).verifyToken(`${header}.${payload}.`)).toThrow(AuthError);
  });

  it('rejects a token minted for another issuer', () => {
    const now = 1_700_000_000;
    const token = codec({ nowSeconds: () => now, issuer: 'someone-else' }).issue('user-1').token;
    expect(() => codec({ nowSeconds: () => now }).verifyToken(token)).toThrow(AuthError);
  });

  it('rejects malformed tokens without throwing anything but AuthError', () => {
    const verifier = codec();
    for (const broken of ['', 'a', 'a.b', 'a.b.c', '....', 'not.a.jwt']) {
      expect(() => verifier.verifyToken(broken)).toThrow(AuthError);
    }
  });

  it('refuses to sign without a subject', () => {
    expect(() => codec().issue('')).toThrow(AuthError);
  });

  it('refuses to build a codec without a secret', () => {
    expect(() =>
      createHs256Codec({ secret: '', ttlSeconds: 60, issuer: DEFAULT_ISSUER, clockToleranceSeconds: 0 }),
    ).toThrow(/without a secret/);
  });
});

describe('secret resolution (fail closed in production)', () => {
  it('uses JWT_SECRET when it is a real value', () => {
    expect(resolveJwtSecret({ JWT_SECRET: 'a-strong-secret' })).toEqual({
      secret: 'a-strong-secret',
      source: 'env',
    });
  });

  it('treats the .env.example placeholder as "not configured"', () => {
    expect(resolveJwtSecret({ JWT_SECRET: INSECURE_EXAMPLE_SECRET }).source).toBe('dev-fallback');
    expect(resolveJwtSecret({ JWT_SECRET: '   ' }).source).toBe('dev-fallback');
    expect(resolveJwtSecret({}).secret).toBe(DEV_JWT_SECRET_FALLBACK);
  });

  it('throws instead of starting production on a fallback secret', () => {
    expect(() => resolveJwtSecret({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
    expect(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: INSECURE_EXAMPLE_SECRET })).toThrow();
    expect(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'real' })).not.toThrow();
  });

  it('reads the optional TTL override and ignores nonsense', () => {
    expect(resolveTokenTtlSeconds({ JWT_TTL_SECONDS: '60' })).toBe(60);
    expect(resolveTokenTtlSeconds({ JWT_TTL_SECONDS: '0' })).toBe(7 * 24 * 3600);
    expect(resolveTokenTtlSeconds({ JWT_TTL_SECONDS: 'abc' })).toBe(7 * 24 * 3600);
    expect(resolveTokenTtlSeconds({})).toBe(7 * 24 * 3600);
  });

  it('buildJwtConfig keeps an explicitly supplied secret untouched', () => {
    expect(buildJwtConfig({ secret: 'explicit' }).secret).toBe('explicit');
  });
});
