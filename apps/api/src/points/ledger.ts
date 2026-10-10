/**
 * Points ledger -- PROJECT_GUIDE rules F1-F8.
 *
 * Four numbers, three of which are always shown together (F2):
 *
 *   累计获得 earned    - points awarded for completed tasks. Never decreases (F4).
 *   当前可用 available  - earned - spent. The stored `Membership.points` column (F5).
 *   已消费 spent       - points that left the member for good: redeems + wish contributions.
 *   冻结中 frozen      - a RESERVED SUBSET of `available`, not an extra pot (C3).
 *
 * ---------------------------------------------------------------------------------------------
 * THE IDENTITY (F6, wording agreed by the product owner on 2026-10-10):
 *
 *   earned - spent === available          <- what the three numbers must satisfy
 *   available - frozen = spendable        <- F7: 可用余额 = 当前可用 − 冻结中
 *
 * WHY THIS READING AND NOT THE OTHER ONE: the guide originally wrote the identity as
 * `earned - spent - frozen === available`. That cannot coexist with bounty reservations (C3):
 *   - reserving would have to deduct from `available`, so 冻结 could never exceed 可用;
 *   - refunding an expired bounty would then have to credit `available` from nowhere, which
 *     forces 累计获得 down -- contradicting F4 (only grows) and F1 (append only).
 * The owner chose this reading; see docs/ai-logs/ops/2026-10-10-2100_W1-C_media-web.md and
 * PROJECT_GUIDE F6. Do not "fix" it locally in another module.
 * ---------------------------------------------------------------------------------------------
 *
 * Holds move money BETWEEN available and frozen, never out of the member:
 *   publish a bounty : frozen += X                    (delta 0)
 *   bounty expires   : frozen -= X                    (delta 0)
 *   bounty gets done : frozen -= X, available -= X    (delta -X; the reward lands with the worker)
 *
 * Pure functions: no database, no clock, no side effects.
 */
import type { PointsReason, PointsSnapshot } from '@fcp/shared';

export interface LedgerEntry {
  /** change of the member's available (non-held) balance */
  delta: number;
  /** true only for earning rows (task rewards). Never true for spending rows. */
  earned: boolean;
  reason: PointsReason;
  /**
   * Change of the reserved amount in the SAME transaction:
   *   bounty_hold   -> +X (available -> frozen)
   *   bounty_refund -> -X (frozen -> available)
   *   bounty_payout -> -X (the reservation leaves the member together with delta = -X)
   * Defaults to 0.
   */
  frozenDelta?: number;
}

/**
 * Reasons that only move money in or out of the reservation without it ever leaving the member.
 * `bounty_payout` is deliberately NOT here: when a bounty is completed the reserved points DO
 * leave the publisher, so they count as spending -- that is what keeps F6 true.
 */
export const HOLD_REASONS: PointsReason[] = ['bounty_hold', 'bounty_refund'];

/** Reasons that must never be flagged as earned. */
export const NOT_EARNABLE_REASONS: PointsReason[] = [
  'bounty_hold',
  'bounty_payout',
  'wish_contribute',
  'redeem',
  'reverse',
];

export function roundPoints(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Recompute the four numbers from the ledger alone.
 * This is the authority: the cached columns on Membership must always equal this (F1),
 * which is what the daily reconcilePoints job (J7) verifies.
 */
export function computeSnapshot(entries: LedgerEntry[], initialFrozen = 0): PointsSnapshot {
  let earned = 0;
  let earnedTotal = 0;
  let available = 0;
  let spent = 0;
  let frozen = roundPoints(initialFrozen);

  for (const e of entries) {
    const delta = roundPoints(e.delta);
    const frozenDelta = roundPoints(e.frozenDelta ?? 0);

    frozen = roundPoints(frozen + frozenDelta);
    available = roundPoints(available + delta);

    if (delta > 0 && e.earned) {
      earned = roundPoints(earned + delta);
      earnedTotal = roundPoints(earnedTotal + delta);
    }
    // A reversal undoes an award: honour points disappear with the money, but it is not spending.
    if (delta < 0 && e.reason === 'reverse') {
      earned = roundPoints(earned + delta);
    }
    // Spending = money that left the member for good. Reserving it is not spending.
    if (delta < 0 && !HOLD_REASONS.includes(e.reason) && e.reason !== 'reverse') {
      spent = roundPoints(spent + Math.abs(delta));
    }
  }

  return { earned, available, spent, frozen, earnedTotal };
}

/** F6 identity check: earned - spent - available. 0 means healthy. */
export function checkIdentity(snapshot: PointsSnapshot): number {
  return roundPoints(snapshot.earned - snapshot.spent - snapshot.available);
}

export function isIdentityValid(snapshot: PointsSnapshot): boolean {
  return checkIdentity(snapshot) === 0;
}

/** Money the member can actually commit right now (F7). */
export function spendable(snapshot: PointsSnapshot): number {
  return roundPoints(snapshot.available - snapshot.frozen);
}

export class LedgerError extends Error {}

export interface ApplyResult {
  entries: LedgerEntry[];
  snapshot: PointsSnapshot;
}

/**
 * Append one ledger row and refresh the numbers.
 *
 * Guards (each one has bitten a similar product before):
 *   - F7: no overdraft, the reservation stays covered by the balance
 *   - F4: earned only grows, except through `reverse` (which is still checked for sanity)
 *   - F6: the identity must hold after every single row, or the row never reaches the database
 */
export function applyEntry(entries: LedgerEntry[], entry: LedgerEntry, initialFrozen = 0): ApplyResult {
  const delta = roundPoints(entry.delta);
  const frozenDelta = roundPoints(entry.frozenDelta ?? 0);
  const before = computeSnapshot(entries, initialFrozen);

  if (delta === 0 && frozenDelta === 0) {
    throw new LedgerError('ledger entry with zero delta is meaningless');
  }
  if (delta > 0 && NOT_EARNABLE_REASONS.includes(entry.reason)) {
    throw new LedgerError(`reason ${entry.reason} must not increase the available balance`);
  }
  if (delta < 0 && entry.reason === 'task_done') {
    throw new LedgerError('task rewards must be positive (a reversal uses reason=reverse)');
  }
  if (delta < 0 && entry.earned && entry.reason !== 'reverse') {
    throw new LedgerError(
      `a negative row can only decrease earned via reason=reverse (got ${entry.reason})`,
    );
  }

  const availableAfter = roundPoints(before.available + delta);
  const frozenAfter = roundPoints(before.frozen + frozenDelta);

  if (availableAfter < 0) {
    throw new LedgerError(
      `insufficient balance: available ${before.available}, attempted delta ${delta} (F7: no overdraft)`,
    );
  }
  if (frozenDelta < 0 && Math.abs(frozenDelta) > before.frozen) {
    throw new LedgerError(
      `cannot release ${Math.abs(frozenDelta)} reserved points when only ${before.frozen} are reserved`,
    );
  }
  if (frozenAfter < 0) {
    throw new LedgerError(
      `frozen amount cannot go negative (was ${before.frozen}, delta ${frozenDelta})`,
    );
  }
  if (frozenAfter > availableAfter) {
    if (frozenDelta > 0) {
      throw new LedgerError(
        `cannot reserve ${frozenAfter} points out of an available balance of ${availableAfter} ` +
          `(F7: the reservation is a subset of the balance)`,
      );
    }
    throw new LedgerError(
      `insufficient balance: releasing the reservation would need ${Math.abs(delta)} points, ` +
        `but only ${availableAfter} would be available (F7: no overdraft)`,
    );
  }

  const next = [...entries, { ...entry, delta, frozenDelta }];
  const snapshot = computeSnapshot(next, initialFrozen);

  if (entry.reason === 'reverse') {
    if (snapshot.earned < 0) throw new LedgerError('a reversal cannot push earned below zero');
  } else if (snapshot.earned < before.earned) {
    throw new LedgerError('cumulative earned must never decrease except through reason=reverse (F4)');
  }

  // F6 is checked on every write: a row that breaks the books never reaches the database.
  const drift = checkIdentity(snapshot);
  if (drift !== 0) {
    throw new LedgerError(
      `entry breaks the F6 identity by ${drift} ` +
        `(earned ${snapshot.earned} - spent ${snapshot.spent} != available ${snapshot.available})`,
    );
  }

  return { entries: next, snapshot };
}

/** Apply a whole batch; throws on the first violation and leaves the input untouched. */
export function applyEntries(
  entries: LedgerEntry[],
  batch: LedgerEntry[],
  initialFrozen = 0,
): ApplyResult {
  let current: ApplyResult = { entries, snapshot: computeSnapshot(entries, initialFrozen) };
  for (const entry of batch) {
    current = applyEntry(current.entries, entry, initialFrozen);
  }
  return current;
}

// ---------------------------------------------------------------- builders

/** C3: reserve bounty points when a temporary task is published. The money stays in the balance. */
export function buildBountyHold(points: number): LedgerEntry {
  if (points <= 0) throw new LedgerError('hold must be positive');
  return { delta: 0, frozenDelta: roundPoints(points), earned: false, reason: 'bounty_hold' };
}

/** C3: release the reservation when the bounty expires without a taker. */
export function buildBountyRefund(points: number): LedgerEntry {
  if (points <= 0) throw new LedgerError('refund must be positive');
  return { delta: 0, frozenDelta: roundPoints(-points), earned: false, reason: 'bounty_refund' };
}

/** C3: the bounty is done -- the reserved points leave the publisher (the worker's award is separate). */
export function buildBountyPayout(points: number): LedgerEntry {
  if (points <= 0) throw new LedgerError('payout must be positive');
  return {
    delta: roundPoints(-points),
    frozenDelta: roundPoints(-points),
    earned: false,
    reason: 'bounty_payout',
  };
}

/** The worker side of a completed bounty (same shape as any task award). */
export function buildBountyEarned(points: number): LedgerEntry {
  if (points <= 0) throw new LedgerError('award must be positive');
  return { delta: roundPoints(points), earned: true, reason: 'task_done' };
}

/**
 * E8: the owner re-scored a task, so the original award is undone.
 * The reversal takes the honour points back with the money; `earnedTotal` keeps the history.
 */
export function buildReversal(previousPoints: number): LedgerEntry {
  if (previousPoints <= 0) throw new LedgerError('nothing to reverse');
  return { delta: roundPoints(-previousPoints), earned: true, reason: 'reverse' };
}

/** The corrected award after a re-settlement (E8). */
export function buildAward(points: number, reason: PointsReason = 'task_done'): LedgerEntry {
  if (points <= 0) throw new LedgerError('award must be positive');
  if (!['task_done', 'admin_adjust'].includes(reason)) {
    throw new LedgerError(`reason ${reason} is not an award reason`);
  }
  return { delta: roundPoints(points), earned: reason === 'task_done', reason };
}

/** H8: the notification must carry the three numbers. */
export function formatPointsNotice(
  nickname: string,
  taskTitle: string,
  gained: number,
  snapshot: PointsSnapshot,
): string {
  return (
    `${nickname}完成${taskTitle},获得 ${roundPoints(gained)} 分` +
    `(累计获得 ${snapshot.earned} / 可用 ${snapshot.available} / 已消费 ${snapshot.spent})`
  );
}
