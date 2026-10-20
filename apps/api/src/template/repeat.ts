/**
 * `repeatRule` parsing and matching -- the only real logic in M2, and the home of its two documented
 * boundary cases:
 *
 *   `weekly:7`   -> the 7th ISO weekday is **Sunday**; it must FIRE, not be rejected.
 *   `monthly:31` -> February has no 31st, so the rule simply never matches that month.
 *                   It must NOT throw: "no such day" is a normal outcome, not a broken rule.
 *
 * Accepted grammar (mirrors the comment on `TaskTemplate.repeatRule` in `schema.prisma`):
 *
 *   daily
 *   weekly:1,3,5     ISO weekdays, 1 = Monday .. 7 = Sunday
 *   monthly:1        days of month, 1 .. 31
 *
 * Leniency is deliberate and bounded: surrounding whitespace and letter case are tolerated
 * (`Weekly: 1, 3` parses), duplicates collapse and the list is sorted, so `weekly:5,1,1` and
 * `weekly:1,5` are the same rule. Everything else is rejected with `invalid_repeat_rule`, because a
 * rule nobody can read is worse than a clear 400.
 */
import { TemplateError } from './errors.js';

const WEEKLY_MIN = 1;
const WEEKLY_MAX = 7;
const MONTHLY_MIN = 1;
const MONTHLY_MAX = 31;

export type RepeatRule =
  | { readonly kind: 'daily' }
  | { readonly kind: 'weekly'; readonly days: readonly number[] }
  | { readonly kind: 'monthly'; readonly days: readonly number[] };

/** Splits the part after `:` and validates every element as an integer inside `[min, max]`. */
function parseDayList(raw: string, min: number, max: number): number[] | null {
  const parts = raw.split(',');
  if (parts.length === 0) return null;

  const days: number[] = [];
  for (const part of parts) {
    const text = part.trim();
    // `""`, `"1.5"`, `"0x2"`, `"1e2"` must all fail: only plain decimal digits are a day.
    if (!/^\d+$/.test(text)) return null;
    const value = Number(text);
    if (!Number.isInteger(value) || value < min || value > max) return null;
    days.push(value);
  }

  // Deduplicate + sort so equivalent rules compare and format identically.
  return [...new Set(days)].sort((a, b) => a - b);
}

/**
 * Parses a stored/`requested` rule. Throws `TemplateError.invalidRepeatRule` (400) when unusable.
 *
 * `unknown` rather than `string` on purpose: this is called from the service with data that came off
 * the wire, so it must survive `undefined`, `null` and non-strings without a runtime type error.
 */
export function parseRepeatRule(raw: unknown): RepeatRule {
  if (typeof raw !== 'string') throw TemplateError.invalidRepeatRule(raw);

  const text = raw.trim().toLowerCase();
  if (text === 'daily') return { kind: 'daily' };

  const separator = text.indexOf(':');
  if (separator <= 0) throw TemplateError.invalidRepeatRule(raw);

  const kind = text.slice(0, separator);
  const rest = text.slice(separator + 1);

  if (kind === 'weekly') {
    const days = parseDayList(rest, WEEKLY_MIN, WEEKLY_MAX);
    if (days === null) throw TemplateError.invalidRepeatRule(raw);
    return { kind: 'weekly', days };
  }
  if (kind === 'monthly') {
    const days = parseDayList(rest, MONTHLY_MIN, MONTHLY_MAX);
    if (days === null) throw TemplateError.invalidRepeatRule(raw);
    return { kind: 'monthly', days };
  }

  throw TemplateError.invalidRepeatRule(raw);
}

/** Non-throwing variant, for places that need a boolean (e.g. a filter pre-check). */
export function isValidRepeatRule(raw: unknown): boolean {
  try {
    parseRepeatRule(raw);
    return true;
  } catch {
    return false;
  }
}

/** Canonical text form: `daily` / `weekly:1,3,5` / `monthly:1`. Round-trips through `parseRepeatRule`. */
export function formatRepeatRule(rule: RepeatRule): string {
  switch (rule.kind) {
    case 'daily':
      return 'daily';
    case 'weekly':
      return `weekly:${rule.days.join(',')}`;
    case 'monthly':
      return `monthly:${rule.days.join(',')}`;
  }
}

/**
 * ISO weekday: 1 = Monday .. 7 = Sunday.
 *
 * `Date.getDay()` is 0 = Sunday .. 6 = Saturday, which is the single easiest off-by-one in this
 * feature: treating `weekly:7` as Saturday means the Sunday chore silently never runs.
 */
export function isoWeekday(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

/**
 * Should a template with this rule fire on this date?
 *
 * `date` is read in the server's local timezone; the family's `timezone` is not applied here because
 * M3 (the generator) is where "which calendar day is it for that family" gets decided. Keeping this
 * function free of timezone logic is what makes it testable with a plain `new Date(2026, 1, 28)`.
 */
export function matchesDate(rule: RepeatRule, date: Date): boolean {
  switch (rule.kind) {
    case 'daily':
      return true;
    case 'weekly':
      return rule.days.includes(isoWeekday(date));
    case 'monthly':
      // Day 31 in February: `getDate()` maxes out at 28/29, so this is `false` -- no throw, no
      // "skip to the last day" cleverness. The household asked for the 31st; that month has none.
      return rule.days.includes(date.getDate());
  }
}

/** Convenience for callers holding a raw rule string (M3 will use this). */
export function shouldFireOn(rawRule: string, date: Date): boolean {
  return matchesDate(parseRepeatRule(rawRule), date);
}
