/**
 * Points ledger -- PROJECT_GUIDE rules F1-F8.
 *
 * Four numbers, three of which are always shown together (F2):
 *
 *   累计获得 earned    - cumulative earned, only ever grows; the "honour" figure (F4)
 *   当前可用 available  - everything that is not currently held; the balance column (F5)
 *   已消费 spent       - money that actually left the member: redeems + wish contributions
 *   冻结中 frozen      - held for your own open bounties (C3: held up front, refunded on expiry)
 *
 * ---------------------------------------------------------------------------------------------
 * SEMANTICS (lane C, 2026-10-10 -- chosen as the only self-consistent reading of the guide)
 *
 *   累计获得 earned    = every earning row ever written. Only grows. (F4)
 *   当前可用 available  = earned - spent. The stored `Membership.points` column. (F5)
 *   已消费 spent       = redeems + wish contributions + reversals.
 *   冻结中 frozen      = a RESERVED SUBSET of `available`, not an extra pot. (C3)
 *
 *   identity (F6):  earned - spent === available      <- true by construction, so the daily
 *                                                       reconcile job (J7) can actually fail loudly
 *   spendable now :  available - frozen               <- "余额 = 可用 − 冻结" from F7
 *
 * Holds move money BETWEEN available and frozen, never out of the member:
 *   publish a bounty : frozen += X                    (delta 0)
 *   bounty expires   : frozen -= X                    (delta 0)
 *   bounty gets done : frozen -= X, available -= X    (delta -X; the reward lands with the worker)
 *
 * !! OPEN QUESTION FOR THE HUMANS (see docs/ai-logs/ops/...-W1-C_media-web.md) !!
 * The guide states the identity as `累计获得 − 已消费 − 冻结 = 可用`, which contradicts F7's
 * "可用余额 = 当前可用 − 冻结中". Both cannot hold. This module implements the second one
 * (frozen as a subset) because it is the only reading under which the identity is non-trivial
 * and the ledger stays consistent. If the humans decide otherwise, this file is the only place
 * that changes -- do NOT patch it locally in another module.
 * ---------------------------------------------------------------------------------------------
 *
 * Pure functions only: no database, no clock, no side effects, so the API, the daily
 * reconciliation job and the frontend can all share ONE implementation.
 */
import type { PointsReason, PointsSnapshot } from '@fcp/shared';

export interface LedgerEntry {
  /** change of the member's available (non-held) points */
  delta: number;
  /** true only for earning rows (task rewards). Never true for spending rows. */
  earned: boolean;
  reason: PointsReason;
  /**
   * Change of the held amount in the same transaction:
   *   bounty_hold   -> +amount (available -> frozen)
   *   bounty_refund -> -amount (frozen -> available, so delta is also +amount)
   *   bounty payout -> -amount (the hold leaves the publisher for the worker)
   * Defaults to 0.
   */
  frozenDelta?: number;
}

/** Reasons that only move money into or out of the hold; they are neither earning nor spending. */
export const HOLD_REASONS: PointsReason[] = ['bounty_hold', 'bounty_refund', 'bounty_payout'];

/**
 * Reasons that must never be flagged as earned.
 * NOTE: `bounty_refund` is deliberately NOT here -- releasing a hold returns money to the
 * spendable balance, so its delta is positive. It is still not "earning" (earned stays false).
 */
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
 *
 * This is the authority: the cached columns on Membership must always equal this (F1),
 * which is exactly what the daily reconcilePoints job (J7) verifies.
 */
export function computeSnapshot(entries: LedgerEntry[], initialFrozen = 0): PointsSnapshot {
  let earned = 0;
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
    }
    // Spending = money that left the member for good. Moving it into the hold does not.
    if (delta < 0 && !HOLD_REASONS.includes(e.reason)) {
      spent = roundPoints(spent + Math.abs(delta));
    }
    // A bounty payout takes the money out of the member AND out of the hold at the same time.
    if (e.reason === 'bounty_payout' && delta < 0) {
      spent = roundPoints(spent + Math.abs(delta));
    }
  }

  return { earned, available, spent, frozen };
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
 * Guards encoded here (each one has bitten a similar product before):
 *   - F7: no overdraft -- checked before writing
 *   - F7: held points are not spendable twice
 *   - F4: earned only increases; reversing an award lowers 已消费, never 累计获得
 *   - a negative row can never be flagged `earned`
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
  if (delta < 0 && entry.earned) {
    throw new LedgerError('a negative row can never be flagged as earned');
  }
  if (before.frozen + frozenDelta < 0) {
    throw new LedgerError(
      `frozen amount cannot go negative (was ${before.frozen}, delta ${frozenDelta})`,
    );
  }

  const availableAfter = roundPoints(before.available + delta);
  if (availableAfter < 0) {
    throw new LedgerError(
      `insufficient balance: available ${before.available}, attempted delta ${delta} (F7: no overdraft)`,
    );
  }
  // F7: the reserved part must stay covered by the balance, and can never exceed it.
  // The two checks are separate on purpose: "cannot spend" (the member has no money) and
  // "cannot hold" (the member has money but wants to reserve more than exists) are different
  // situations for the UI, and one row can trip both.
  const frozenAfter = roundPoints(before.frozen + frozenDelta);
  if (frozenAfter < 0) {
    throw new LedgerError(
      `frozen amount cannot go negative (was ${before.frozen}, delta ${frozenDelta})`,
    );
  }
  if (availableAfter < frozenAfter) {
    // Distinguish "the member is broke" from "the reservation is bigger than the balance".
    if (before.available + delta <= before.frozen) {
      throw new LedgerError(
        `insufficient balance: available ${before.available}, frozen ${before.frozen}, ` +
          `attempted delta ${delta} (F7: reserved points are not spendable)`,
      );
    }
    throw new LedgerError(
      `cannot hold ${frozenAfter} points out of an available balance of ${availableAfter} ` +
        `(F7: the hold is a subset of the balance)`,
    );
  }

  const next = [...entries, { ...entry, delta, frozenDelta }];
  const snapshot = computeSnapshot(next, initialFrozen);

  if (snapshot.earned < before.earned) {
    throw new LedgerError('cumulative earned must never decrease (F4)');
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

/**
 * Overwrite re-settlement (E8: the owner scores late and the result is recalculated).
 * The old reward is reversed with its own row instead of editing history (F1: append only).
 */
export function buildReversal(previousPoints: number): LedgerEntry {
  if (previousPoints <= 0) throw new LedgerError('nothing to reverse');
  return { delta: roundPoints(-previousPoints), earned: false, reason: 'reverse' };
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
