/**
 * Use cases for the `template` module: create / list / pause / resume (M2, CONTRACTS #11/#18/#19).
 *
 * Three rules shape almost every line below.
 *
 * 1. **B1 -- only the owner writes.** Every mutating use case calls `assertOwner()` *before* it looks
 *    at the payload, so a non-owner learns nothing about which fields would have been wrong.
 *    Reading the list only needs membership, because the whole family shares the schedule.
 * 2. **B2 -- a template without a ceiling is meaningless.** `maxPoints` is the multiplier the scoring
 *    rule applies; a missing or non-positive value is a 400, never a silent default.
 * 3. **No second state machine.** This module owns templates only. Instances (and their status flow)
 *    belong to M1; `repeat.ts` answers "would this fire today?" and nothing more.
 *
 * Validation lives here rather than in the route layer, matching `family`: the HTTP layer checks
 * *shape* (zod), this file checks *rules*, so the two can never disagree about what a valid template
 * is. Every failure is a `TemplateError`, so the route has exactly one error path.
 */
import { TemplateError } from './errors.js';
import { parseRepeatRule } from './repeat.js';
import { createInMemoryTemplateRepository } from './repository.js';
import type {
  AssignMode,
  ClaimerScope,
  Clock,
  CreateTemplateInput,
  MembershipReader,
  TaskTemplateRecord,
  TemplateRepository,
  TemplateStatus,
  TemplateSummary,
} from './types.js';

/* ------------------------------------------------------------------------------------------------
 * Defaults and limits -- all traceable to PROJECT_GUIDE 4.2 (B1-B8) or to `schema.prisma`
 * ---------------------------------------------------------------------------------------------- */

/** B3: "可设提前多久提醒(默认提前 30 分钟)". Same default as the schema column. */
export const DEFAULT_REMIND_BEFORE_MIN = 30;

/** 0 means "notify at the deadline"; a day is the useful upper bound for a household reminder. */
export const REMIND_BEFORE_MIN_MIN = 0;
export const REMIND_BEFORE_MIN_MAX = 24 * 60;

/** Matches `@default("claim")` on `TaskTemplate.assignMode` (B5). */
export const DEFAULT_ASSIGN_MODE: AssignMode = 'claim';
/** Matches `@default("all")` on `TaskTemplate.claimerScope` (B6). */
export const DEFAULT_CLAIMER_SCOPE: ClaimerScope = 'all';
/** Matches `@default(true)` on `TaskTemplate.mustBeClaimed` (B4). */
export const DEFAULT_MUST_BE_CLAIMED = true;

/**
 * Generous upper bounds, matching lane B's convention: they only stop an absurd payload. There is no
 * documented product limit on a task title, so inventing a tight one would be inventing a rule.
 */
export const TEMPLATE_TITLE_MAX_LENGTH = 200;
export const TEMPLATE_DESCRIPTION_MAX_LENGTH = 500;

/** `"14:00"` -- 24-hour wall clock, as the schema comment specifies. */
const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const ASSIGN_MODES: readonly AssignMode[] = ['claim', 'rotate'];
const CLAIMER_SCOPES: readonly ClaimerScope[] = ['all', 'children', 'specific'];

/* ------------------------------------------------------------------------------------------------
 * Inputs / outputs
 * ---------------------------------------------------------------------------------------------- */

/** What the HTTP layer hands over. Fields stay optional because defaults are a *rule*, not a shape. */
export interface CreateTemplateRequest {
  title: string;
  description?: string;
  timeOfDay: string;
  repeatRule: string;
  maxPoints: number;
  assignMode?: AssignMode;
  claimerScope?: ClaimerScope;
  mustBeClaimed?: boolean;
  remindBeforeMin?: number;
}

/** Fully validated, defaults applied. What the repository actually stores (minus identity/time). */
export interface NormalizedTemplateInput {
  title: string;
  description: string | null;
  timeOfDay: string;
  repeatRule: string;
  maxPoints: number;
  assignMode: AssignMode;
  claimerScope: ClaimerScope;
  mustBeClaimed: boolean;
  remindBeforeMin: number;
}

/** `'all'` is a filter, not a status -- it exists so the UI can show the history in one call. */
export type TemplateListFilter = TemplateStatus | 'all';

/** M2 only moves a template between these two (B7). `archived` is reserved by the schema. */
export type TemplateSettableStatus = 'active' | 'paused';

export interface TemplateService {
  createTemplate(
    callerId: string,
    familyId: string,
    input: CreateTemplateRequest,
  ): Promise<{ template: TemplateSummary }>;
  listTemplates(
    callerId: string,
    familyId: string,
    filter?: TemplateListFilter,
  ): Promise<{ templates: TemplateSummary[] }>;
  setTemplateStatus(
    callerId: string,
    familyId: string,
    templateId: string,
    status: TemplateStatus,
  ): Promise<{ template: TemplateSummary }>;
}

export interface CreateTemplateServiceOptions {
  repository?: TemplateRepository;
  /**
   * Required, deliberately. A default would mean "no idea who the caller is", and B1 would silently
   * stop being enforced -- the exact failure mode `routes/family.ts` guards against by throwing when
   * `app.requireAuth` is missing rather than serving unauthenticated.
   */
  memberships: MembershipReader;
  clock?: Clock;
}

/* ------------------------------------------------------------------------------------------------
 * Pure validation -- exported so it can be tested without a repository
 * ---------------------------------------------------------------------------------------------- */

interface ValidationIssue {
  path: string;
  message: string;
}

function readText(value: unknown, path: string, max: number, issues: ValidationIssue[]): string {
  if (typeof value !== 'string') {
    issues.push({ path, message: 'is required and must be a string' });
    return '';
  }
  const text = value.trim();
  if (text.length === 0) {
    issues.push({ path, message: 'must not be empty' });
    return '';
  }
  if (text.length > max) {
    issues.push({ path, message: `must be at most ${max} characters` });
    return '';
  }
  return text;
}

export function normalizeCreateTemplateInput(input: CreateTemplateRequest): NormalizedTemplateInput {
  // `repeatRule` is parsed first on purpose: it has its own contract code (`invalid_repeat_rule`),
  // so a bad rule must not be downgraded into a generic field error.
  const repeatRule = parseRepeatRule((input as { repeatRule?: unknown }).repeatRule);

  const issues: ValidationIssue[] = [];

  const title = readText(input.title, 'title', TEMPLATE_TITLE_MAX_LENGTH, issues);

  let description: string | null = null;
  const rawDescription = (input as { description?: unknown }).description;
  if (rawDescription !== undefined && rawDescription !== null) {
    if (typeof rawDescription !== 'string') {
      issues.push({ path: 'description', message: 'must be a string when provided' });
    } else {
      const text = rawDescription.trim();
      if (text.length > TEMPLATE_DESCRIPTION_MAX_LENGTH) {
        issues.push({
          path: 'description',
          message: `must be at most ${TEMPLATE_DESCRIPTION_MAX_LENGTH} characters`,
        });
      } else {
        // An empty description is stored as "absent", never as an empty string: the wire shape omits
        // it, and `''` would render as a stray blank line in the task list.
        description = text.length === 0 ? null : text;
      }
    }
  }

  const timeOfDay = typeof input.timeOfDay === 'string' ? input.timeOfDay.trim() : '';
  if (!TIME_OF_DAY_PATTERN.test(timeOfDay)) {
    issues.push({ path: 'timeOfDay', message: 'must be HH:MM between 00:00 and 23:59' });
  }

  // B2: the ceiling is the scoring multiplier. `typeof` guards against `"3"` arriving from a client
  // that stringified numbers, and `Number.isFinite` rejects NaN/Infinity from a JSON `1e999`.
  const maxPoints = (input as { maxPoints?: unknown }).maxPoints;
  if (typeof maxPoints !== 'number' || !Number.isFinite(maxPoints) || maxPoints <= 0) {
    issues.push({ path: 'maxPoints', message: 'is required and must be a number greater than 0' });
  }

  const rawAssignMode = (input as { assignMode?: unknown }).assignMode;
  const assignMode = rawAssignMode === undefined ? DEFAULT_ASSIGN_MODE : rawAssignMode;
  if (!ASSIGN_MODES.includes(assignMode as AssignMode)) {
    issues.push({ path: 'assignMode', message: `must be one of ${ASSIGN_MODES.join(' | ')}` });
  }

  const rawScope = (input as { claimerScope?: unknown }).claimerScope;
  const claimerScope = rawScope === undefined ? DEFAULT_CLAIMER_SCOPE : rawScope;
  if (!CLAIMER_SCOPES.includes(claimerScope as ClaimerScope)) {
    issues.push({ path: 'claimerScope', message: `must be one of ${CLAIMER_SCOPES.join(' | ')}` });
  }

  const rawMustBeClaimed = (input as { mustBeClaimed?: unknown }).mustBeClaimed;
  const mustBeClaimed =
    rawMustBeClaimed === undefined ? DEFAULT_MUST_BE_CLAIMED : rawMustBeClaimed;
  if (typeof mustBeClaimed !== 'boolean') {
    issues.push({ path: 'mustBeClaimed', message: 'must be a boolean' });
  }

  // B3: default 30 when omitted; explicit 0 is allowed and means "at the deadline".
  const rawRemind = (input as { remindBeforeMin?: unknown }).remindBeforeMin;
  const remindBeforeMin = rawRemind === undefined ? DEFAULT_REMIND_BEFORE_MIN : rawRemind;
  if (
    typeof remindBeforeMin !== 'number' ||
    !Number.isInteger(remindBeforeMin) ||
    remindBeforeMin < REMIND_BEFORE_MIN_MIN ||
    remindBeforeMin > REMIND_BEFORE_MIN_MAX
  ) {
    issues.push({
      path: 'remindBeforeMin',
      message: `must be an integer between ${REMIND_BEFORE_MIN_MIN} and ${REMIND_BEFORE_MIN_MAX}`,
    });
  }

  if (issues.length > 0) throw TemplateError.validation(issues);

  return {
    title,
    description,
    timeOfDay,
    repeatRule: formatRule(repeatRule),
    maxPoints: maxPoints as number,
    assignMode: assignMode as AssignMode,
    claimerScope: claimerScope as ClaimerScope,
    mustBeClaimed: mustBeClaimed as boolean,
    remindBeforeMin: remindBeforeMin as number,
  };
}

/** Local re-export so this file does not need to import `formatRepeatRule` just for one call. */
function formatRule(rule: ReturnType<typeof parseRepeatRule>): string {
  switch (rule.kind) {
    case 'daily':
      return 'daily';
    case 'weekly':
      return `weekly:${rule.days.join(',')}`;
    case 'monthly':
      return `monthly:${rule.days.join(',')}`;
  }
}

/** Row -> wire shape. `description` is omitted when absent; `createdAt` becomes an ISO string. */
export function toTemplateSummary(record: TaskTemplateRecord): TemplateSummary {
  const summary: TemplateSummary = {
    id: record.id,
    familyId: record.familyId,
    title: record.title,
    timeOfDay: record.timeOfDay,
    repeatRule: record.repeatRule,
    maxPoints: record.maxPoints,
    assignMode: record.assignMode,
    claimerScope: record.claimerScope,
    mustBeClaimed: record.mustBeClaimed,
    remindBeforeMin: record.remindBeforeMin,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
  };
  if (record.description !== null) summary.description = record.description;
  return summary;
}

/* ------------------------------------------------------------------------------------------------
 * The service
 * ---------------------------------------------------------------------------------------------- */

export function createTemplateService(options: CreateTemplateServiceOptions): TemplateService {
  const repository = options.repository ?? createInMemoryTemplateRepository();
  const { memberships } = options;
  const clock: Clock = options.clock ?? (() => new Date());

  async function requireMembership(callerId: string, familyId: string): Promise<void> {
    const membership = await memberships.findMembership(callerId, familyId);
    // An unknown family and a family the caller is not in answer identically (403), so this endpoint
    // cannot be used to probe which family ids exist.
    if (membership === null) throw TemplateError.notAMember();
  }

  async function requireOwner(callerId: string, familyId: string): Promise<void> {
    const membership = await memberships.findMembership(callerId, familyId);
    if (membership === null) throw TemplateError.notAMember();
    if (membership.role !== 'owner') throw TemplateError.notOwner();
  }

  return {
    async createTemplate(callerId, familyId, input) {
      if (typeof familyId !== 'string' || familyId.length === 0) {
        throw TemplateError.validation({ path: 'fid', message: 'is required' });
      }
      // B1 first: a non-owner must not learn which of their fields would also have been rejected.
      await requireOwner(callerId, familyId);

      const normalized = normalizeCreateTemplateInput(input);

      const record: CreateTemplateInput = {
        familyId,
        ...normalized,
        createdBy: callerId,
        createdAt: clock(),
      };
      const created = await repository.create(record);
      return { template: toTemplateSummary(created) };
    },

    async listTemplates(callerId, familyId, filter = 'active') {
      if (typeof familyId !== 'string' || familyId.length === 0) {
        throw TemplateError.validation({ path: 'fid', message: 'is required' });
      }
      // Reading only needs membership: the schedule is shared, which is the point of the product.
      await requireMembership(callerId, familyId);

      const all = await repository.listByFamily(familyId);
      const rows = filter === 'all' ? all : all.filter((row) => row.status === filter);
      return { templates: rows.map(toTemplateSummary) };
    },

    async setTemplateStatus(callerId, familyId, templateId, status) {
      if (typeof familyId !== 'string' || familyId.length === 0) {
        throw TemplateError.validation({ path: 'fid', message: 'is required' });
      }
      if (typeof templateId !== 'string' || templateId.length === 0) {
        throw TemplateError.validation({ path: 'tid', message: 'is required' });
      }
      await requireOwner(callerId, familyId);

      // `archived` is reserved by the schema; M2 does not expose it (B7 only says pause/resume).
      if (status !== 'active' && status !== 'paused') {
        throw TemplateError.invalidStatusTransition('unknown', String(status));
      }

      const existing = await repository.findById(templateId);
      // Wrong family or unknown id answer the same 404 -- see the repository's scoping note.
      if (existing === null || existing.familyId !== familyId) {
        throw TemplateError.templateNotFound();
      }
      if (existing.status === 'archived') {
        throw TemplateError.invalidStatusTransition(existing.status, status);
      }
      if (existing.status === status) {
        // Idempotent on purpose: two people tapping "pause" in a family group should not produce an
        // error for the second one. Nothing changed, so nothing is written.
        return { template: toTemplateSummary(existing) };
      }

      const updated = await repository.setStatus(templateId, familyId, status);
      if (updated === null) throw TemplateError.templateNotFound();
      return { template: toTemplateSummary(updated) };
    },
  };
}
