import { describe, expect, it } from 'vitest';
import {
  buildDeletionUpdate,
  computeExpireAt,
  decideDeletion,
  displayHoursLeft,
  dueReminders,
  hoursUntilExpiry,
  isExpired,
  planCronPass,
  type InstanceLike,
  type ProofLike,
} from './expiry.js';

const H = 3_600_000;
const T0 = new Date('2026-03-01T10:00:00.000Z');

function proof(overrides: Partial<ProofLike> = {}): ProofLike {
  return {
    id: 'p1',
    createdAt: T0,
    expireAt: computeExpireAt(T0), // 2026-03-04T10:00:00Z
    status: 'valid',
    firedReminders: [],
    ...overrides,
  };
}

const settled: InstanceLike = { id: 'i1', status: 'done' };
const waitingScore: InstanceLike = { id: 'i1', status: 'pending_score' };

describe('proof expiry - PROJECT_GUIDE 4.10 / D8 / D9', () => {
  it('D8: expireAt is exactly 72 hours after upload', () => {
    const e = computeExpireAt(T0);
    expect(e.toISOString()).toBe('2026-03-04T10:00:00.000Z');
    expect(hoursUntilExpiry(proof(), T0)).toBe(72);
  });

  it('TTL is configurable (Q14) without touching call sites', () => {
    expect(computeExpireAt(T0, 24).toISOString()).toBe('2026-03-02T10:00:00.000Z');
  });

  it('is not expired one millisecond before the deadline, and expired exactly at it', () => {
    const p = proof();
    expect(isExpired(p, new Date(T0.getTime() + 72 * H - 1))).toBe(false);
    expect(isExpired(p, new Date(T0.getTime() + 72 * H))).toBe(true);
  });

  it('countdown shows whole hours and never goes negative', () => {
    const p = proof();
    expect(displayHoursLeft(p, T0)).toBe(72);
    expect(displayHoursLeft(p, new Date(T0.getTime() + 71.5 * H))).toBe(0); // 0.5h left -> 0
    expect(displayHoursLeft(p, new Date(T0.getTime() + 80 * H))).toBe(0);   // past due -> clamped
  });

  it('D9: the 24h reminder fires once, at 24 hours remaining', () => {
    const p = proof();
    expect(dueReminders(p, new Date(T0.getTime() + 47 * H))).toEqual([]);       // 25h left
    expect(dueReminders(p, new Date(T0.getTime() + 48 * H))).toEqual([24]);     // 24h left
    expect(dueReminders(p, new Date(T0.getTime() + 60 * H))).toEqual([24]);     // still 24h owed
  });

  it('D9: an already fired threshold is not repeated (hourly cron safety)', () => {
    const p = proof({ firedReminders: [24] });
    expect(dueReminders(p, new Date(T0.getTime() + 60 * H))).toEqual([]);
    expect(dueReminders(p, new Date(T0.getTime() + 66 * H))).toEqual([6]);      // 6h left
  });

  it('D9: after downtime several thresholds can be owed at once, urgent first', () => {
    const p = proof();
    const late = new Date(T0.getTime() + 67 * H); // 5h left -> both 24 and 6 are owed
    expect(dueReminders(p, late)).toEqual([6, 24]);
  });

  it('no reminder is sent once the proof is expired', () => {
    expect(dueReminders(proof(), new Date(T0.getTime() + 73 * H))).toEqual([]);
  });

  it('4.10: a settled instance lets the evidence go at the deadline', () => {
    const now = new Date(T0.getTime() + 72 * H);
    expect(decideDeletion(proof(), settled, now)).toEqual({ action: 'delete', reason: 'settled' });
  });

  it('4.10: an unsettled instance must be settled BEFORE the evidence is deleted', () => {
    const now = new Date(T0.getTime() + 72 * H);
    expect(decideDeletion(proof(), waitingScore, now)).toEqual({
      action: 'settle_then_delete',
      reason: 'not_settled',
    });
  });

  it('nothing happens before the deadline, whatever the instance status is', () => {
    const now = new Date(T0.getTime() + 71 * H);
    expect(decideDeletion(proof(), settled, now)).toEqual({ action: 'keep', reason: 'not_due_yet' });
    expect(decideDeletion(proof(), waitingScore, now)).toEqual({ action: 'keep', reason: 'not_due_yet' });
  });

  it('an expired row is never processed twice (idempotent cron)', () => {
    const now = new Date(T0.getTime() + 100 * H);
    expect(decideDeletion(proof({ status: 'expired' }), settled, now)).toEqual({
      action: 'keep',
      reason: 'already_expired',
    });
  });

  it('planCronPass splits one hourly pass into delete / settle-then-delete / remind', () => {
    const now = new Date(T0.getTime() + 73 * H);
    const older = new Date(T0.getTime() - 80 * H); // uploaded 80h before T0 -> expired 8h before T0
    const fresh = new Date(T0.getTime() + 71 * H); // uploaded long after T0 -> still valid at `now`

    const plan = planCronPass(
      [
        { proof: proof({ id: 'settled-proof' }), instance: settled },
        { proof: proof({ id: 'unsettled-proof' }), instance: waitingScore },
        {
          proof: proof({ id: 'stale-proof', createdAt: older, expireAt: computeExpireAt(older) }),
          instance: waitingScore,
        },
        {
          proof: proof({ id: 'fresh-proof', createdAt: fresh, expireAt: computeExpireAt(fresh) }),
          instance: waitingScore,
        },
      ],
      now,
    );

    expect(plan.toDelete).toEqual(['settled-proof']);
    expect(plan.toSettleThenDelete).toEqual(['unsettled-proof', 'stale-proof']);
    // fresh-proof is not due yet (expires 70h after `now`), so it is left completely alone
    expect(plan.toRemind).toEqual([]);
  });

  it('planCronPass collects reminders for proofs still inside the window', () => {
    const now = new Date(T0.getTime() + 60 * H); // 12h left
    const plan = planCronPass([{ proof: proof(), instance: waitingScore }], now);
    expect(plan.toDelete).toEqual([]);
    expect(plan.toSettleThenDelete).toEqual([]);
    expect(plan.toRemind).toEqual([{ proofId: 'p1', thresholds: [24] }]);
  });

  it('the storage guard refuses to delete evidence that is not due (defence in depth)', () => {
    expect(() => buildDeletionUpdate(proof(), T0)).toThrow(/not due/);
    expect(buildDeletionUpdate(proof(), new Date(T0.getTime() + 72 * H))).toEqual({
      status: 'expired',
      deletedAt: '2026-03-04T10:00:00.000Z',
    });
  });
});
