/**
 * Proof media lifecycle -- PROJECT_GUIDE section 4.10 and rules D8 / D9.
 *
 * Task evidence (photos / videos) lives exactly PROOF_TTL_HOURS (default 72h) from upload,
 * then it is deleted. Two rules make this module trickier than it looks:
 *
 *   1. "settle first, delete second": evidence may only be removed once the instance is settled
 *      (or the fallback settlement has run). If the deadline arrives and nobody scored, we must
 *      settle first, then delete.
 *   2. reminders must fire exactly once per threshold, even though the cron job runs hourly.
 *
 * Everything here is a pure function: pass in `now`. No database, no clock, no side effects,
 * so it is fully unit-testable -- same approach as scoring/settle.ts.
 */
import { PROOF_REMIND_BEFORE_HOURS, PROOF_TTL_HOURS } from '@fcp/shared';

export const MS_PER_HOUR = 3_600_000;

/** Statuses that count as "settled" for the purpose of allowing deletion. */
export const SETTLED_INSTANCE_STATUSES = ['done', 'rejected'] as const;

/** Statuses that must be settled before their evidence can be deleted. */
export const UNSETTLED_INSTANCE_STATUSES = ['pending_score', 'doing', 'claimed', 'open'] as const;

export interface ProofLike {
  id: string;
  /** ISO string or Date */
  createdAt: string | Date;
  /** ISO string or Date; written at upload time = createdAt + PROOF_TTL_HOURS */
  expireAt: string | Date;
  status: 'valid' | 'expired';
  /** reminder thresholds (hours) already sent for this proof, e.g. [24] */
  firedReminders?: number[];
}

export interface InstanceLike {
  id: string;
  status: string;
}

/** Compute the expiry timestamp for a proof uploaded now. Write this at upload time (D8). */
export function computeExpireAt(uploadedAt: Date, ttlHours: number = PROOF_TTL_HOURS): Date {
  return new Date(uploadedAt.getTime() + ttlHours * MS_PER_HOUR);
}

export function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Signed hours until expiry; negative means already past due. */
export function hoursUntilExpiry(proof: ProofLike, now: Date): number {
  return (toDate(proof.expireAt).getTime() - now.getTime()) / MS_PER_HOUR;
}

/** Whole hours remaining, floored at 0 -- this is what the UI countdown shows. */
export function displayHoursLeft(proof: ProofLike, now: Date): number {
  return Math.max(0, Math.floor(hoursUntilExpiry(proof, now)));
}

/** Hard deadline reached? At exactly expireAt it is already expired (>=), matching D8. */
export function isExpired(proof: ProofLike, now: Date): boolean {
  return now.getTime() >= toDate(proof.expireAt).getTime();
}

/**
 * Which reminder thresholds should be sent right now.
 *
 * A threshold T fires when the remaining time has dropped to T or below and T has not been
 * fired yet. Because the cron runs hourly, several thresholds can become due at once
 * (e.g. the service was down); we return all of them, ordered by urgency (smallest first),
 * so the caller can decide to collapse them into one message.
 */
export function dueReminders(
  proof: ProofLike,
  now: Date,
  thresholds: number[] = PROOF_REMIND_BEFORE_HOURS,
): number[] {
  if (isExpired(proof, now)) return [];
  const left = hoursUntilExpiry(proof, now);
  const fired = proof.firedReminders ?? [];
  return thresholds
    .filter((t) => left <= t && !fired.includes(t))
    .sort((a, b) => a - b);
}

export type DeleteDecision =
  | { action: 'delete'; reason: 'settled' }
  | { action: 'settle_then_delete'; reason: 'not_settled' }
  | { action: 'keep'; reason: 'not_due_yet' | 'already_expired' };

/**
 * Decide what to do with one proof.
 *
 * The "settle first" rule protects the family from losing evidence before anyone scored it
 * (otherwise the 24h fallback score would be computed with nothing to look at).
 */
export function decideDeletion(proof: ProofLike, instance: InstanceLike, now: Date): DeleteDecision {
  if (proof.status === 'expired') return { action: 'keep', reason: 'already_expired' };
  if (!isExpired(proof, now)) return { action: 'keep', reason: 'not_due_yet' };

  const settled = (SETTLED_INSTANCE_STATUSES as readonly string[]).includes(instance.status);
  return settled
    ? { action: 'delete', reason: 'settled' }
    : { action: 'settle_then_delete', reason: 'not_settled' };
}

export interface CronPlan {
  /** proofs whose instance is already settled -> delete now */
  toDelete: string[];
  /** proofs whose instance is not settled -> settle first, then delete */
  toSettleThenDelete: string[];
  /** proofs that are due for a reminder -> proofId + thresholds */
  toRemind: Array<{ proofId: string; thresholds: number[] }>;
}

/**
 * One hourly pass, as a pure function: returns the plan, the caller executes it.
 * Keeping the plan pure means the cron job holds no business rules of its own.
 */
export function planCronPass(
  proofs: Array<{ proof: ProofLike; instance: InstanceLike }>,
  now: Date,
  thresholds: number[] = PROOF_REMIND_BEFORE_HOURS,
): CronPlan {
  const plan: CronPlan = { toDelete: [], toSettleThenDelete: [], toRemind: [] };

  for (const { proof, instance } of proofs) {
    const reminders = dueReminders(proof, now, thresholds);
    if (reminders.length > 0) {
      plan.toRemind.push({ proofId: proof.id, thresholds: reminders });
    }

    const decision = decideDeletion(proof, instance, now);
    if (decision.action === 'delete') plan.toDelete.push(proof.id);
    else if (decision.action === 'settle_then_delete') plan.toSettleThenDelete.push(proof.id);
  }

  return plan;
}

/**
 * Guard for the storage layer: never delete a file whose row is not due yet.
 * Also returns the new row values so callers cannot forget to stamp `deletedAt`.
 */
export function buildDeletionUpdate(proof: ProofLike, now: Date): {
  status: 'expired';
  deletedAt: string;
} {
  if (!isExpired(proof, now)) {
    throw new Error(`refusing to delete proof ${proof.id}: not due until ${toDate(proof.expireAt).toISOString()}`);
  }
  return { status: 'expired', deletedAt: now.toISOString() };
}

/** ISO timestamp shown in the UI: "证据有效期至 3 月 5 日 14:30". */
export function expiryLabel(proof: ProofLike): string {
  return toDate(proof.expireAt).toISOString();
}
