import { describe, expect, it } from 'vitest';
import {
  EMAIL_MAX_LENGTH,
  PHONE_MAX_DIGITS,
  detectAccountKind,
  normalizeAccount,
  normalizeEmail,
  normalizeNickname,
  normalizePhone,
} from './identifiers.js';

describe('phone normalisation', () => {
  it('keeps a plain mainland mobile number', () => {
    expect(normalizePhone('13800138000')).toBe('13800138000');
  });

  it('strips spaces, dashes, dots and parentheses', () => {
    expect(normalizePhone(' 138-0013-8000 ')).toBe('13800138000');
    expect(normalizePhone('(138) 0013.8000')).toBe('13800138000');
  });

  it('drops a leading + and a typed country code', () => {
    expect(normalizePhone('+8613800138000')).toBe('13800138000');
    expect(normalizePhone('8613800138000')).toBe('13800138000');
    expect(normalizePhone('+1 415 555 0100')).toBe('14155550100');
  });

  it('rejects anything that is not plausibly a phone number', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
    expect(normalizePhone('138-ABCD-8000')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('1'.repeat(PHONE_MAX_DIGITS + 1))).toBeNull();
  });
});

describe('email normalisation', () => {
  it('lower-cases and trims, which is what makes the DB unique index case-insensitive', () => {
    expect(normalizeEmail('  Dad@Example.COM ')).toBe('dad@example.com');
  });

  it('rejects malformed addresses', () => {
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
    expect(normalizeEmail('a b@example.com')).toBeNull();
    expect(normalizeEmail(`${'x'.repeat(EMAIL_MAX_LENGTH)}@example.com`)).toBeNull();
  });
});

describe('the single `account` field (CONTRACTS #3/#4 rule 1)', () => {
  it('uses @ as the discriminator, exactly like lane C\x27s mock does', () => {
    expect(detectAccountKind('dad@example.com')).toBe('email');
    expect(detectAccountKind('13800138000')).toBe('phone');
  });

  it('returns the kind together with the normalised value', () => {
    expect(normalizeAccount('Dad@Example.com')).toEqual({
      kind: 'email',
      value: 'dad@example.com',
    });
    expect(normalizeAccount(' +86 138-0013-8000 ')).toEqual({
      kind: 'phone',
      value: '13800138000',
    });
  });

  it('returns null for an unusable account', () => {
    expect(normalizeAccount('abc')).toBeNull();
    expect(normalizeAccount('@')).toBeNull();
    expect(normalizeAccount('')).toBeNull();
  });
});

describe('nickname normalisation', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normalizeNickname('  弟弟  ')).toBe('弟弟');
    expect(normalizeNickname('小  明')).toBe('小 明');
  });

  it('rejects empty and over-long nicknames', () => {
    expect(normalizeNickname('   ')).toBeNull();
    expect(normalizeNickname('x'.repeat(25))).toBeNull();
  });

  it('accepts the 12 characters the UI caps input at', () => {
    expect(normalizeNickname('x'.repeat(12))).toHaveLength(12);
  });
});
