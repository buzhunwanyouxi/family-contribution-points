/**
 * `repeat.ts` boundaries -- the two cases that are easy to get subtly wrong.
 *
 * Dates are anchored to the Unix epoch (1970-01-01, a **Thursday**) instead of guessing what weekday
 * some arbitrary date is. That keeps the test honest: if the implementation used `Date.getDay()`
 * (0 = Sunday) where it should use an ISO weekday (1 = Monday .. 7 = Sunday), `weekly:7` would land
 * on Saturday and exactly one of these assertions fails.
 */
import { describe, expect, it } from 'vitest';
import { TemplateError } from './errors.js';
import {
  formatRepeatRule,
  isValidRepeatRule,
  isoWeekday,
  matchesDate,
  parseRepeatRule,
  shouldFireOn,
} from './repeat.js';

/** 1970-01-01 was a Thursday; +3 days is the first Sunday. */
const THURSDAY = new Date(1970, 0, 1);
const SUNDAY = new Date(1970, 0, 4);

function expectInvalidRepeatRule(raw: unknown): void {
  const error = (() => {
    try {
      parseRepeatRule(raw);
      return null;
    } catch (caught) {
      return caught as TemplateError;
    }
  })();
  expect(error).toBeInstanceOf(TemplateError);
  expect(error?.code).toBe('invalid_repeat_rule');
  expect(error?.status).toBe(400);
}

describe('isoWeekday', () => {
  it('maps Sunday to 7 and Thursday to 4 (ISO), not to the JS 0/4', () => {
    // Ground truth first: the epoch really is a Thursday in `Date.getDay()` terms too.
    expect(THURSDAY.getDay()).toBe(4);
    expect(SUNDAY.getDay()).toBe(0);

    expect(isoWeekday(THURSDAY)).toBe(4);
    expect(isoWeekday(SUNDAY)).toBe(7);
  });
});

describe('parseRepeatRule', () => {
  it('accepts the three documented forms', () => {
    expect(parseRepeatRule('daily')).toEqual({ kind: 'daily' });
    expect(parseRepeatRule('weekly:1,3,5')).toEqual({ kind: 'weekly', days: [1, 3, 5] });
    expect(parseRepeatRule('monthly:1')).toEqual({ kind: 'monthly', days: [1] });
  });

  it('accepts weekly:7 -- 7 is Sunday, the highest legal weekday', () => {
    expect(parseRepeatRule('weekly:7')).toEqual({ kind: 'weekly', days: [7] });
  });

  it('tolerates case and spaces, and normalises duplicates and order', () => {
    expect(parseRepeatRule('  Weekly: 5, 1 ,1 ')).toEqual({ kind: 'weekly', days: [1, 5] });
    expect(parseRepeatRule('MONTHLY:31,1')).toEqual({ kind: 'monthly', days: [1, 31] });
  });

  it('rejects anything it cannot read, as invalid_repeat_rule (400)', () => {
    for (const raw of [
      undefined,
      null,
      '',
      '   ',
      'hourly',
      'every-day',
      'weekly',
      'weekly:',
      'weekly:0',
      'weekly:8',
      'weekly:1.5',
      'weekly:1,,3',
      'weekly:mon',
      'monthly:0',
      'monthly:32',
      'monthly:-1',
      'daily:1',
    ]) {
      expectInvalidRepeatRule(raw);
    }
  });

  it('exposes a non-throwing predicate with the same verdicts', () => {
    expect(isValidRepeatRule('weekly:7')).toBe(true);
    expect(isValidRepeatRule('weekly:8')).toBe(false);
    expect(isValidRepeatRule(undefined)).toBe(false);
  });
});

describe('matchesDate', () => {
  it('daily fires on every day', () => {
    const rule = parseRepeatRule('daily');
    expect(matchesDate(rule, THURSDAY)).toBe(true);
    expect(matchesDate(rule, SUNDAY)).toBe(true);
  });

  it('weekly:7 fires on Sunday and NOT on Saturday', () => {
    const rule = parseRepeatRule('weekly:7');
    const saturday = new Date(1970, 0, 3);
    expect(saturday.getDay()).toBe(6);

    expect(matchesDate(rule, SUNDAY)).toBe(true);
    expect(matchesDate(rule, saturday)).toBe(false);
  });

  it('weekly:1,3,5 fires on Mon/Wed/Fri only', () => {
    const rule = parseRepeatRule('weekly:1,3,5');
    // 1970-01-05 was a Monday.
    expect(matchesDate(rule, new Date(1970, 0, 5))).toBe(true);
    expect(matchesDate(rule, new Date(1970, 0, 6))).toBe(false); // Tuesday
    expect(matchesDate(rule, new Date(1970, 0, 7))).toBe(true); // Wednesday
    expect(matchesDate(rule, new Date(1970, 0, 8))).toBe(false); // Thursday
    expect(matchesDate(rule, new Date(1970, 0, 9))).toBe(true); // Friday
  });

  it('monthly:31 does not fire in February -- and does not throw', () => {
    const rule = parseRepeatRule('monthly:31');
    // February never has a 31st. "No such day" is a normal outcome, not a broken rule.
    for (const day of [1, 15, 28]) {
      expect(() => matchesDate(rule, new Date(2026, 1, day))).not.toThrow();
      expect(matchesDate(rule, new Date(2026, 1, day))).toBe(false);
    }
    // The same rule must still fire in a month that HAS a 31st.
    expect(matchesDate(rule, new Date(2026, 0, 31))).toBe(true);
  });

  it('monthly:29 fires on Feb 29 in a leap year and never in a common year', () => {
    const rule = parseRepeatRule('monthly:29');
    expect(matchesDate(rule, new Date(2024, 1, 29))).toBe(true); // 2024 is a leap year
    expect(matchesDate(rule, new Date(2026, 1, 28))).toBe(false); // 2026 is not
  });

  it('shouldFireOn accepts the raw stored string (what M3 will hold)', () => {
    expect(shouldFireOn('weekly:7', SUNDAY)).toBe(true);
    expect(shouldFireOn('weekly:7', THURSDAY)).toBe(false);
  });
});

describe('formatRepeatRule', () => {
  it('round-trips through parseRepeatRule in canonical form', () => {
    for (const raw of ['daily', 'weekly:1,3,5', 'monthly:1', 'weekly:7']) {
      const text = formatRepeatRule(parseRepeatRule(raw));
      expect(text).toBe(raw);
      expect(parseRepeatRule(text)).toEqual(parseRepeatRule(raw));
    }
  });

  it('emits the normalised form for messy input', () => {
    expect(formatRepeatRule(parseRepeatRule(' Weekly: 3,1,3 '))).toBe('weekly:1,3');
  });
});
