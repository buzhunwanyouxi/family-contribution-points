import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INVITE_TTL_DAYS,
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH,
  createCryptoRandom,
  encodeInviteCode,
  generateUniqueInviteCode,
  isInviteExpired,
  isWellFormedInviteCode,
  normalizeInviteCode,
  resolveInviteExpiry,
  resolveInviteTtlDays,
} from './invite.js';

/** A deterministic stand-in for `Math.random`, so encoded output can be pinned. */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length] ?? 0;
    index += 1;
    return value;
  };
}

describe('invite alphabet - PROJECT_GUIDE A2', () => {
  it('is exactly 32 characters so the index is unbiased', () => {
    expect(INVITE_ALPHABET).toHaveLength(32);
    expect(new Set(INVITE_ALPHABET).size).toBe(32);
  });

  it('omits the characters a family member would confuse when reading it aloud', () => {
    for (const ambiguous of ['0', '1', 'O', 'I']) {
      expect(INVITE_ALPHABET).not.toContain(ambiguous);
    }
  });

  it('is upper-case alphanumeric, which is what the shipped form expects', () => {
    expect(INVITE_ALPHABET).toMatch(/^[A-Z0-9]+$/);
    expect(INVITE_CODE_LENGTH).toBe(6);
  });
});

describe('encodeInviteCode', () => {
  it('maps a known random sequence to a known code', () => {
    // 0 / 32 -> index 0 ('2'); 31.9 / 32 -> index 31 ('Z')
    expect(encodeInviteCode(sequence([0, 0.999]), 2)).toBe('2Z');
  });

  it('produces the requested length', () => {
    expect(encodeInviteCode(createCryptoRandom())).toHaveLength(INVITE_CODE_LENGTH);
    expect(encodeInviteCode(createCryptoRandom(), 10)).toHaveLength(10);
  });

  it('only ever emits alphabet characters, over many crypto draws', () => {
    const random = createCryptoRandom();
    for (let round = 0; round < 200; round += 1) {
      const code = encodeInviteCode(random);
      expect(isWellFormedInviteCode(code)).toBe(true);
    }
  });
});

describe('normalizeInviteCode', () => {
  it('upper-cases what the user typed', () => {
    expect(normalizeInviteCode('8f3k2q')).toBe('8F3K2Q');
  });

  it('drops separators a pasted code may carry', () => {
    expect(normalizeInviteCode(' 8f3-2k q ')).toBe('8F32KQ');
    expect(normalizeInviteCode('8F3_2KQ')).toBe('8F32KQ');
    expect(normalizeInviteCode('8F3-K2Q')).toBe('8F3K2Q');
  });

  it('returns an empty string for non-strings instead of throwing', () => {
    expect(normalizeInviteCode(undefined)).toBe('');
    expect(normalizeInviteCode(42)).toBe('');
  });
});

describe('isWellFormedInviteCode', () => {
  it('accepts a well-formed code', () => {
    expect(isWellFormedInviteCode('8F3K2Q')).toBe(true);
  });

  it('rejects wrong lengths', () => {
    expect(isWellFormedInviteCode('8F3K2')).toBe(false);
    expect(isWellFormedInviteCode('8F3K2QX')).toBe(false);
    expect(isWellFormedInviteCode('')).toBe(false);
  });

  it('rejects characters outside the alphabet', () => {
    expect(isWellFormedInviteCode('8F3K2O')).toBe(false); // O is excluded
    expect(isWellFormedInviteCode('8F3K21')).toBe(false); // 1 is excluded
    expect(isWellFormedInviteCode('8f3k2q')).toBe(false); // normalisation is the caller's job
  });
});

describe('invite expiry - A2 "带有效期"', () => {
  const now = new Date('2026-03-01T10:00:00.000Z');

  it('defaults to a week', () => {
    expect(DEFAULT_INVITE_TTL_DAYS).toBe(7);
    expect(resolveInviteExpiry(now).toISOString()).toBe('2026-03-08T10:00:00.000Z');
  });

  it('honours an explicit ttl', () => {
    expect(resolveInviteExpiry(now, 1).toISOString()).toBe('2026-03-02T10:00:00.000Z');
  });

  it('treats a null expiry as "never expires"', () => {
    expect(isInviteExpired(null, now)).toBe(false);
  });

  it('is not expired one millisecond before the deadline', () => {
    const expireAt = new Date(now.getTime() + 1);
    expect(isInviteExpired(expireAt, now)).toBe(false);
  });

  it('is expired exactly at the deadline', () => {
    expect(isInviteExpired(new Date(now.getTime()), now)).toBe(true);
  });

  it('is expired after the deadline', () => {
    expect(isInviteExpired(new Date(now.getTime() - 1), now)).toBe(true);
  });
});

describe('resolveInviteTtlDays', () => {
  it('falls back to the default when nothing is configured', () => {
    expect(resolveInviteTtlDays({})).toBe(DEFAULT_INVITE_TTL_DAYS);
  });

  it('reads FAMILY_INVITE_TTL_DAYS from the injected env bag', () => {
    expect(resolveInviteTtlDays({ FAMILY_INVITE_TTL_DAYS: '30' })).toBe(30);
  });

  it('ignores nonsense instead of producing a broken expiry', () => {
    expect(resolveInviteTtlDays({ FAMILY_INVITE_TTL_DAYS: 'soon' })).toBe(DEFAULT_INVITE_TTL_DAYS);
    expect(resolveInviteTtlDays({ FAMILY_INVITE_TTL_DAYS: '0' })).toBe(DEFAULT_INVITE_TTL_DAYS);
    expect(resolveInviteTtlDays({ FAMILY_INVITE_TTL_DAYS: '-3' })).toBe(DEFAULT_INVITE_TTL_DAYS);
  });
});

describe('generateUniqueInviteCode', () => {
  it('returns the first free candidate', async () => {
    const code = await generateUniqueInviteCode(async () => false, sequence([0, 0, 0, 0, 0, 0]));
    expect(code).toBe('222222');
  });

  it('retries when the repository says the code is taken', async () => {
    const taken = new Set(['222222']);
    // 0 -> index 0 ('2'), 0.5 -> index 16 ('J'); the first six draws are taken, so it moves on.
    const code = await generateUniqueInviteCode(
      async (candidate) => taken.has(candidate),
      sequence([0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
    );
    expect(code).toBe('JJJJJJ');
  });

  it('throws instead of looping forever when no code is ever free', async () => {
    await expect(generateUniqueInviteCode(async () => true, sequence([0]), 3)).rejects.toThrow(
      /unique invite code/,
    );
  });
});
