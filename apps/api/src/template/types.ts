/**
 * Domain types and the persistence port for the `template` module -- M2 (CONTRACTS #11 / #18 / #19).
 *
 * Scope: the **fixed-task templates** a family defines once, which the daily job (M3) later expands
 * into `TaskInstance` rows. This module deliberately knows nothing about instances: that state
 * machine belongs to M1, and `AGENTS.md` section 5 forbids a second copy of any such rule.
 *
 * The product rules below are transcribed from `docs/PROJECT_GUIDE.md` section 4.2 (B1-B8), and the
 * row shape mirrors `model TaskTemplate` in `apps/api/prisma/schema.prisma`:
 *
 *   B1  only the family **owner** may create a template            -> `not_owner` (403)
 *   B2  every template **must** have `maxPoints` > 0               -> `validation_error` (400)
 *   B3  `remindBeforeMin`, default 30
 *   B4  `mustBeClaimed`, default true
 *   B5  `assignMode`: `claim` (先到先得) | `rotate` (轮值)
 *   B6  `claimerScope`: `all` | `children` | `specific`
 *   B7  pause / resume, history retained
 *   B8  holiday / school-holiday task sets -- **NOT implemented here.** There is no column for it in
 *       the schema, so implementing it would mean inventing a data model. Recorded as not-done in
 *       this round's ops log (section 4) rather than silently skipped.
 */
import type { Role } from '@fcp/shared';

/** `TaskTemplate.assignMode` (B5). Persisted as ASCII, like every other status column. */
export type AssignMode = 'claim' | 'rotate';

/** `TaskTemplate.claimerScope` (B6). `specific` needs a member list the schema does not have yet. */
export type ClaimerScope = 'all' | 'children' | 'specific';

/**
 * `TaskTemplate.status`.
 *
 * M2 only transitions `active <-> paused` (B7). `archived` is reserved by the schema; nothing in this
 * module sets it, and asking for it is rejected instead of quietly accepted.
 */
export type TemplateStatus = 'active' | 'paused' | 'archived';

/* ------------------------------------------------------------------------------------------------
 * Persistence row -- a mirror of `model TaskTemplate`
 * ---------------------------------------------------------------------------------------------- */

export interface TaskTemplateRecord {
  id: string;
  familyId: string;
  title: string;
  description: string | null;
  /** `"14:00"` -- local wall-clock time of day the task should happen. */
  timeOfDay: string;
  /** Raw rule string, e.g. `daily` / `weekly:1,3,5` / `monthly:1`. Parsed by `repeat.ts`. */
  repeatRule: string;
  maxPoints: number;
  assignMode: AssignMode;
  claimerScope: ClaimerScope;
  mustBeClaimed: boolean;
  remindBeforeMin: number;
  status: TemplateStatus;
  createdBy: string;
  createdAt: Date;
}

export interface CreateTemplateInput {
  familyId: string;
  title: string;
  description: string | null;
  timeOfDay: string;
  repeatRule: string;
  maxPoints: number;
  assignMode: AssignMode;
  claimerScope: ClaimerScope;
  mustBeClaimed: boolean;
  remindBeforeMin: number;
  createdBy: string;
  /**
   * Supplied by the caller's injectable clock, not read inside the repository -- otherwise a test
   * with a frozen clock would still get wall-clock timestamps (the same trap `family` documents).
   */
  createdAt: Date;
}

/* ------------------------------------------------------------------------------------------------
 * Wire shapes -- frozen by CONTRACTS #11 / #18 / #19
 * ---------------------------------------------------------------------------------------------- */

/**
 * One template as the API returns it.
 *
 * `createdAt` is an ISO-8601 **string**: a raw `Date` does not JSON-serialise to the shape the
 * contract promises. `description` is omitted (never `null`) when absent, matching the convention
 * lane A established for `UserSummary.phone/email`.
 */
export interface TemplateSummary {
  id: string;
  familyId: string;
  title: string;
  description?: string;
  timeOfDay: string;
  repeatRule: string;
  maxPoints: number;
  assignMode: AssignMode;
  claimerScope: ClaimerScope;
  mustBeClaimed: boolean;
  remindBeforeMin: number;
  status: TemplateStatus;
  createdAt: string;
}

/* ------------------------------------------------------------------------------------------------
 * The two seams
 * ---------------------------------------------------------------------------------------------- */

/**
 * Persistence port. Two implementations will exist, exactly like `auth` / `family`:
 *   - `createInMemoryTemplateRepository()` (repository.ts) -- dev / unit tests, zero setup (ADR-004)
 *   - a Prisma adapter later -- the same shape, so no use case changes.
 */
export interface TemplateRepository {
  create(input: CreateTemplateInput): Promise<TaskTemplateRecord>;
  findById(id: string): Promise<TaskTemplateRecord | null>;
  /** Every template of a family, oldest first. Filtering by status is the service's job. */
  listByFamily(familyId: string): Promise<TaskTemplateRecord[]>;
  /**
   * Returns the updated row, or `null` when no template with that id belongs to that family.
   * Scoped by `familyId` on purpose: an id from another family must not be updatable by guessing.
   */
  setStatus(
    id: string,
    familyId: string,
    status: TemplateStatus,
  ): Promise<TaskTemplateRecord | null>;
}

/**
 * The narrow view of `family` this module needs: "is this caller in that family, and with which
 * role?" (B1).
 *
 * A port rather than a direct `FamilyRepository` import, mirroring lane A's `FamilyDirectoryPort`:
 * `template` only cares about the role, and a structural port means the family module can change its
 * own repository without touching this file. `createInMemoryFamilyRepository()` satisfies it as-is.
 */
export interface MembershipReader {
  findMembership(userId: string, familyId: string): Promise<{ role: Role } | null>;
}

/** Injectable clock; every use case that cares about "now" takes one so tests are deterministic. */
export type Clock = () => Date;
