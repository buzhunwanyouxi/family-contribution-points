import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SCRYPT_PARAMS,
  assertPasswordPolicy,
  hashPassword,
  hashSchemeOf,
  hasHasher,
  registerHasher,
  verifyPassword,
} from './password.js';

describe('password hashing (scrypt, no external dependency)', () => {
  it('produces a scheme-tagged hash that does not contain the plaintext', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(stored).not.toContain('correct horse battery');
    expect(hashSchemeOf(stored)).toBe('scrypt');
    expect(stored.split('$')).toHaveLength(6);
  });

  it('uses a fresh salt each time, so the same password yields different rows', async () => {
    const first = await hashPassword('same-password-twice');
    const second = await hashPassword('same-password-twice');
    expect(first).not.toBe(second);
    expect(await verifyPassword('same-password-twice', first)).toBe(true);
    expect(await verifyPassword('same-password-twice', second)).toBe(true);
  });

  it('embeds the cost parameters so they can be raised without breaking old rows', async () => {
    const stored = await hashPassword('parameterised');
    const parts = stored.split('$');
    expect(parts[1]).toBe(String(SCRYPT_PARAMS.N));
    expect(parts[2]).toBe(String(SCRYPT_PARAMS.r));
    expect(parts[3]).toBe(String(SCRYPT_PARAMS.p));
  });

  it('verifies the correct password', async () => {
    const stored = await hashPassword('a-real-password');
    expect(await verifyPassword('a-real-password', stored)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('a-real-password');
    expect(await verifyPassword('a-real-passwerd', stored)).toBe(false);
  });

  it('rejects an empty password instead of throwing', async () => {
    const stored = await hashPassword('a-real-password');
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('returns false for a malformed stored hash instead of throwing', async () => {
    for (const broken of ['', 'scrypt$', 'scrypt$16384$8$1$only-five-parts', 'not-a-hash']) {
      expect(await verifyPassword('whatever', broken)).toBe(false);
    }
  });

  it('returns false for a scheme that has no registered hasher (bcrypt rows before the swap)', async () => {
    expect(hashSchemeOf('$2b$10$abcdefghijklmnopqrstuv')).toBe('bcrypt');
    expect(hasHasher('bcrypt')).toBe(false);
    expect(await verifyPassword('whatever', '$2b$10$abcdefghijklmnopqrstuv')).toBe(false);
  });

  it('lets a new scheme be plugged in without touching register.ts / login.ts', async () => {
    // Proves the seam documented in password.ts: a future bcrypt/argon2 hasher only needs this.
    registerHasher({
      scheme: 'demo-scheme',
      hash: async (plain) => `demo-scheme$${plain}`,
      verify: async (plain, stored) => stored === `demo-scheme$${plain}`,
      matches: (stored) => stored.startsWith('demo-scheme$'),
    });
    expect(hasHasher('demo-scheme')).toBe(true);
    const stored = await hashPassword('plugged-in', 'demo-scheme');
    expect(await verifyPassword('plugged-in', stored)).toBe(true);
  });

  it('refuses to register the same scheme twice', () => {
    expect(() =>
      registerHasher({
        scheme: 'scrypt',
        hash: async () => 'x',
        verify: async () => false,
        matches: () => false,
      }),
    ).toThrow(/already registered/);
  });

  it('enforces the length policy (6 = the floor the shipped UI already allows)', () => {
    expect(() => assertPasswordPolicy('short')).toThrow(RangeError);
    expect(() => assertPasswordPolicy('x'.repeat(PASSWORD_MAX_LENGTH + 1))).toThrow(RangeError);
    expect(() => assertPasswordPolicy('x'.repeat(PASSWORD_MIN_LENGTH))).not.toThrow();
    expect(() => assertPasswordPolicy('x'.repeat(PASSWORD_MAX_LENGTH))).not.toThrow();
    expect(PASSWORD_MIN_LENGTH).toBe(6);
  });
});
