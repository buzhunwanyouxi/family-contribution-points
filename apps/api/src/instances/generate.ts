/**
 * M3 (J1) -- turn a family's active templates into concrete instances for one day.
 *
 * ## The one rule this file must not reimplement
 *
 * "Does this rule fire on this day" already exists: `template/repeat.ts`'s `shouldFireOn`. This module
 * calls it. Adding a second copy here is the failure this project has already paid for twice (the points
 * arithmetic and settlement both had to be de-duplicated after the fact), and `AGENTS.md` section 5
 * forbids it outright.
 *
 * ## The timezone trap, and the two different kinds of "day"
 *
 * Two questions look the same and are not:
 *
 *   1. **Which calendar day is it for this family right now?** Depends on the instant and the zone.
 *      `calendarDayInZone(instant, timeZone)` answers it. At 2026-10-20T17:00Z a Shanghai family is
 *      already on the 21st, while a London family is still on the 20th.
 *
 *   2. **Does a weekly rule match 2026-10-20?** This does NOT depend on time at all. "The 20th is a
 *      Tuesday" is a calendar fact; no zone can change it.
 *
 * `repeat.ts`'s `matchesDate` reads `date.getDay()` / `date.getDate()` -- the **server's local** getters.
 * So passing it a raw UTC instant for the family's day is wrong: on a UTC server,
 * `new Date('2026-10-20T00:00:00+08:00')` reads back as the 19th. `buildCalendarDay` instead constructs
 * a Date from the same year/month/day in *local* terms, so the getters return exactly the day asked
 * for, whatever the server's zone is. That is the contract `matchesDate` documents, and honouring it is
 * why this file needs no timezone logic inside the rule check.
 *
 * ## `deadlineAt` is a documented judgement call
 *
 * A template carries `timeOfDay` ("14:00" -- when the task should happen) but nothing about when it
 * becomes overdue. `schema.prisma` has `deadlineAt` with the comment "after this moment the instance is
 * overdue", and the two are never defined in terms of each other anywhere in `PROJECT_GUIDE`.
 *
 * This module uses `timeOfDay` on that date, in the family's timezone. It is the narrowest reading --
 * one time field, interpreted literally -- and it is recorded as a spec-gap rather than presented as
 * settled. If a 14:00 chore should be *startable* at 14:00 and *overdue* at midnight, this is wrong and
 * the fix is one function.
 */
import type { TaskTemplateRecord } from '../template/types.js';
import { matchesDate, parseRepeatRule } from '../template/repeat.js';
import type { InstanceRepository, TaskInstanceRecord } from './types.js';
import { InstanceError } from './errors.js';

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** What a generated instance looks like before it is persisted. */
export interface DraftInstance {
  templateId: string;
  familyId: string;
  title: string;
  /** `YYYY-MM-DD`, the family's natural day. */
  date: string;
  maxPoints: number;
  deadlineAt: Date;
}

interface CalendarParts {
  year: number;
  month: number;
  day: number;
}

/**
 * Parse + validate `YYYY-MM-DD`.
 *
 * Rejects `2026-02-31`, which `new Date('2026-02-31')` silently rolls into March. A date that does not
 * exist must be a 400, not a task filed under a day that never happened.
 */
export function parseCalendarDay(raw: unknown): CalendarParts & { text: string } {
  if (typeof raw !== 'string') throw InstanceError.validation({ date: raw });
  const match = CALENDAR_DAY.exec(raw.trim());
  if (match === null) throw InstanceError.validation({ date: raw });

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Round-trip through UTC: if the components survive, the day exists. This is the only way to catch
  // 02-30 / 02-31 / 13-01 without hard-coding month lengths.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw InstanceError.validation({ date: raw, reason: 'no such calendar day' });
  }

  return { year, month, day, text: raw.trim() };
}

/** Throws `validation_error` when the runtime does not recognise the zone. */
export function assertTimeZone(timeZone: unknown): string {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    throw InstanceError.validation({ timeZone });
  }
  try {
    // Constructing the formatter is what validates the identifier -- there is no lighter check.
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw InstanceError.validation({ timeZone, reason: 'unknown time zone' });
  }
  return timeZone;
}

/**
 * Which calendar day is `instant` on, in `timeZone`? Returns `YYYY-MM-DD`.
 *
 * This is question 1 from the header: it depends on both the instant and the zone.
 */
export function calendarDayInZone(instant: Date, timeZone: string): string {
  assertTimeZone(timeZone);
  if (Number.isNaN(instant.getTime())) throw InstanceError.validation({ instant: String(instant) });

  // `en-CA` formats as YYYY-MM-DD, which is the shape we want. `h23` avoids the 24:00 midnight quirk.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(instant);
}

/**
 * A Date whose **local** getters return exactly the given calendar day.
 *
 * This is what `repeat.ts`'s `matchesDate` expects (see its own comment: "read in the server's local
 * timezone ... testable with a plain `new Date(2026, 1, 28)`"). Building it from local components means
 * the answer to "is the 20th a Tuesday" is the same on a server in UTC and one in Shanghai.
 */
export function buildCalendarDay(date: string): Date {
  const { year, month, day } = parseCalendarDay(date);
  return new Date(year, month - 1, day);
}

/** Milliseconds by which `timeZone` is ahead of UTC at `instant`. Shanghai is +28800000 year-round. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }

  const asUtc = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return asUtc - instant.getTime();
}

/**
 * The instant at which the wall clock in `timeZone` reads `<date>T<timeOfDay>`.
 *
 * Two passes: the offset is looked up at the guessed instant, applied, then looked up again at the
 * corrected instant. One pass is enough for zones without DST; the second handles a rule that lands
 * exactly on a transition, where the offset before and after differ.
 */
export function zonedTimeToUtc(date: string, timeOfDay: string, timeZone: string): Date {
  const { year, month, day } = parseCalendarDay(date);
  assertTimeZone(timeZone);

  if (typeof timeOfDay !== 'string' || !TIME_OF_DAY.test(timeOfDay.trim())) {
    // Rejected rather than defaulted: silently moving a task's deadline to midnight hides a bad template.
    throw InstanceError.validation({ timeOfDay, reason: 'expected HH:MM' });
  }
  const [hourText, minuteText] = timeOfDay.trim().split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);

  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstGuess = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  const corrected = new Date(naive - zoneOffsetMs(firstGuess, timeZone));
  return corrected;
}

/**
 * Draft the instances a family should get for one day.
 *
 * Pure: no I/O, no clock, no repository. `date` is already the family's natural day -- whoever calls
 * this decides "today" via `calendarDayInZone`, so a wrong day is a caller bug that is easy to see
 * rather than something hidden in here.
 *
 * Ordering: by `timeOfDay`, then title, so the generated list is stable across runs. Without a stable
 * order, an idempotency test comparing two runs could pass by luck.
 */
export function generateForDate(
  templates: readonly TaskTemplateRecord[],
  date: string,
  timeZone: string,
): DraftInstance[] {
  const day = parseCalendarDay(date);
  assertTimeZone(timeZone);
  const ruleDay = buildCalendarDay(day.text);

  const drafts: DraftInstance[] = [];
  for (const template of templates) {
    // B7: a paused or archived template produces nothing. This is criterion 2.
    if (template.status !== 'active') continue;

    // A template whose rule cannot be parsed must not take the whole run down with it -- one bad row
    // would otherwise mean the family gets no tasks at all, and the failure would look like "nothing
    // generated" rather than "this template is broken".
    let rule;
    try {
      rule = parseRepeatRule(template.repeatRule);
    } catch {
      continue;
    }
    if (!matchesDate(rule, ruleDay)) continue;

    drafts.push({
      templateId: template.id,
      familyId: template.familyId,
      title: template.title,
      date: day.text,
      maxPoints: template.maxPoints,
      deadlineAt: zonedTimeToUtc(day.text, template.timeOfDay, timeZone),
    });
  }

  drafts.sort((a, b) => {
    const byDeadline = a.deadlineAt.getTime() - b.deadlineAt.getTime();
    return byDeadline !== 0 ? byDeadline : a.title.localeCompare(b.title);
  });

  return drafts;
}

/** What one generation run did. `skipped` is normal, not a problem -- see `ensureInstance`. */
export interface GenerationSummary {
  date: string;
  timeZone: string;
  /** Instances this run actually created. */
  created: number;
  /** Drafts that already had an instance. On a re-run this equals `created` of the first run. */
  skipped: number;
  instances: TaskInstanceRecord[];
}

/**
 * Draft the day's instances and persist them idempotently.
 *
 * Split from `generateForDate` on purpose: that one is pure and testable without a database, this one is
 * the only part that needs a repository. Keeping the split visible is what lets the four acceptance
 * criteria be checked without spinning anything up.
 *
 * Re-running is safe by design. Scheduled work gets retried and re-run after a deploy, so "run it twice"
 * has to be a no-op rather than something to remember not to do.
 */
export async function runGeneration(input: {
  repository: Pick<InstanceRepository, 'ensureInstance'>;
  templates: readonly TaskTemplateRecord[];
  date: string;
  timeZone: string;
}): Promise<GenerationSummary> {
  const drafts = generateForDate(input.templates, input.date, input.timeZone);

  const instances: TaskInstanceRecord[] = [];
  let created = 0;
  let skipped = 0;

  for (const draft of drafts) {
    const result = await input.repository.ensureInstance({
      templateId: draft.templateId,
      familyId: draft.familyId,
      date: draft.date,
      title: draft.title,
      maxPoints: draft.maxPoints,
      deadlineAt: draft.deadlineAt,
    });
    if (result.created) created += 1;
    else skipped += 1;
    instances.push(result.instance);
  }

  return {
    date: drafts[0]?.date ?? parseCalendarDay(input.date).text,
    timeZone: input.timeZone,
    created,
    skipped,
    instances,
  };
}
