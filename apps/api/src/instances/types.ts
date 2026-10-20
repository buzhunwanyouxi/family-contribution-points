/**
 * Task instances -- the thing that makes points possible.
 *
 * A `TaskInstance` is one concrete occurrence of a task on one day: "洗碗,2026-10-20,最高 3 分".
 * It is created from a `TaskTemplate` (or ad-hoc, for a temp task), it is claimed by somebody, it is
 * scored, and then it is settled -- and settlement is the only thing that puts points into a ledger.
 *
 * Why this module exists at all: before it, `#10` (evidence upload) had nothing to attach evidence to,
 * `#12` (claim) had nothing to claim, and `#15` (points) could never return a non-zero number because
 * nothing ever wrote one. The four numbers were structurally 0.
 *
 * ## The status machine lives in `service.ts`, not here
 *
 * This file declares *what a status is*; `service.ts` owns *which transitions are legal*. Keeping the
 * two apart matters because the transition table is the single most tempting thing in this project to
 * duplicate -- a claim route that sets `status = 'claimed'` directly would work until the day it
 * disagreed with settlement. `AGENTS.md` section 5 forbids a second implementation of a rule like this,
 * so every route goes through the service.
 */

/**
 * Lifecycle of one instance. The order matters: it is the happy path, left to right.
 *
 *   open -> claimed -> doing -> pending_score -> done
 *
 * `rejected` and `abandoned` are terminal too, but they are not "the task went well".
 */
export type InstanceStatus =
  /** Nobody has taken it. Visible in the pool (D1). */
  | 'open'
  /** Somebody claimed it. Others can no longer take it (D1). */
  | 'claimed'
  /** The claimer started working. */
  | 'doing'
  /** Work submitted, waiting for scores (D6). Evidence has been uploaded by now. */
  | 'pending_score'
  /** Settled and points awarded. Terminal. */
  | 'done'
  /** Settled as not done. Terminal. Points are NOT awarded. */
  | 'rejected'
  /** Given up on: released after the deadline, or withdrawn. Terminal. Counts as a miss (D3). */
  | 'abandoned';

/** Statuses that can never change again. */
export const TERMINAL_STATUSES: readonly InstanceStatus[] = ['done', 'rejected', 'abandoned'];

/** Statuses that are still "live" for the purposes of the task pool. */
export const OPEN_STATUSES: readonly InstanceStatus[] = ['open', 'claimed', 'doing', 'pending_score'];

/**
 * The stored row. Mirrors `model TaskInstance` in `schema.prisma`, with dates as `Date`.
 *
 * `templateId` is nullable because a temp task has no template. `finalPercent`/`finalPoints` are
 * nullable because they only exist after settlement -- writing them early would mean guessing.
 */
export interface TaskInstanceRecord {
  id: string;
  /** null = ad-hoc / temp task (C1-C5), which has no template behind it. */
  templateId: string | null;
  familyId: string;
  /** Natural day in the family's timezone, serialised `YYYY-MM-DD`. Not a timestamp: "the 20th". */
  date: string;
  title: string;
  maxPoints: number;
  status: InstanceStatus;
  /** After this moment the instance is overdue (D3 / D5 key off it). */
  deadlineAt: Date;
  claimerId: string | null;
  claimedAt: Date | null;
  /** True when the system assigned it because nobody claimed in time (D5). */
  autoAssigned: boolean;
  /** Set at settlement only. */
  finalPercent: number | null;
  finalPoints: number | null;
  settledAt: Date | null;
  /** How the score was decided (E4/E13). */
  settledBy: SettledBy | null;
  createdAt: Date;
}

/**
 * Who decided the final percentage. Mirrors `scoring/settle.ts`'s `SettledBy` -- the values are
 * deliberately the same strings so a settlement can be stored without translation.
 */
export type SettledBy = 'owner' | 'others_avg' | 'fallback_60';

/** Fields a caller may set when creating an instance. Everything else is derived or defaulted. */
export interface CreateInstanceInput {
  familyId: string;
  templateId?: string | null;
  date: string;
  title: string;
  maxPoints: number;
  deadlineAt: Date;
}

/** A patch that only touches claim-related fields. Kept narrow so a route cannot smuggle a status. */
export interface ClaimPatch {
  claimerId: string;
  claimedAt: Date;
  autoAssigned: boolean;
}

/** A patch that only touches settlement fields. */
export interface SettlementPatch {
  status: 'done' | 'rejected';
  finalPercent: number;
  finalPoints: number;
  settledAt: Date;
  settledBy: SettledBy;
}

/**
 * Persistence boundary.
 *
 * Deliberately small and transactional-looking: the two `*IfStatus` methods exist because claim and
 * settle must be **compare-and-set**. A read-then-write in the service would let two claimers both see
 * `open` and both win -- which is D1's exact prohibition.
 */
export interface InstanceRepository {
  create(input: CreateInstanceInput): Promise<TaskInstanceRecord>;
  findById(instanceId: string): Promise<TaskInstanceRecord | null>;
  /** All instances of one family on one day, newest deadline first. */
  listByDate(familyId: string, date: string): Promise<TaskInstanceRecord[]>;
  /** Everything for a family -- used by "unsettled instances" queries (D8/E14). */
  listByFamily(familyId: string): Promise<TaskInstanceRecord[]>;

  /**
   * Compare-and-set a status change **without** touching other fields.
   *
   * Returns the updated row, or null when the row is not in `expected` (already moved, or gone).
   * Callers must treat null as "somebody got there first", never as "not found" -- the two need
   * different answers, so `findById` is the way to tell them apart.
   */
  updateStatus(
    instanceId: string,
    expected: InstanceStatus,
    next: InstanceStatus,
  ): Promise<TaskInstanceRecord | null>;

  /** Compare-and-set a claim. Same contract as `updateStatus`. */
  claimIfOpen(instanceId: string, patch: ClaimPatch): Promise<TaskInstanceRecord | null>;

  /** Compare-and-set settlement. Only `pending_score` may settle. */
  settleIfPending(
    instanceId: string,
    patch: SettlementPatch,
  ): Promise<TaskInstanceRecord | null>;
}
