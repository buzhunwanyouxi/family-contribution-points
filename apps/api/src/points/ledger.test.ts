import { describe, expect, it } from 'vitest';
import {
  applyEntries,
  applyEntry,
  buildBountyHold,
  buildBountyPayout,
  buildBountyRefund,
  buildReversal,
  checkIdentity,
  computeSnapshot,
  formatPointsNotice,
  isIdentityValid,
  LedgerError,
  spendable,
  type LedgerEntry,
} from './ledger.js';

const earn = (delta: number): LedgerEntry => ({ delta, earned: true, reason: 'task_done' });
const redeem = (delta: number): LedgerEntry => ({ delta: -Math.abs(delta), earned: false, reason: 'redeem' });
const contribute = (delta: number): LedgerEntry => ({
  delta: -Math.abs(delta),
  earned: false,
  reason: 'wish_contribute',
});

describe('points ledger - PROJECT_GUIDE F1-F8', () => {
  it('F2/F5: the three numbers come out of the ledger', () => {
    const snap = computeSnapshot([earn(3), earn(1.2), redeem(2), contribute(1)]);
    expect(snap.earned).toBe(4.2);    // 累计获得
    expect(snap.spent).toBe(3);       // 已消费
    expect(snap.available).toBe(1.2); // 当前可用
    expect(isIdentityValid(snap)).toBe(true);
  });

  it('F5: the guide example - 40% of a 3 point task is 1.2 points', () => {
    const snap = computeSnapshot([earn(1.2)]);
    expect(snap.earned).toBe(1.2);
    expect(snap.available).toBe(1.2);
    expect(snap.spent).toBe(0);
  });

  it('F6: identity holds for a healthy snapshot', () => {
    expect(checkIdentity({ earned: 15, available: 8, spent: 7, frozen: 2 })).toBe(0);
    expect(isIdentityValid({ earned: 15, available: 8, spent: 7, frozen: 2 })).toBe(true);
  });

  it('F6: a snapshot where money went missing is detected', () => {
    const wrong = { earned: 15, available: 6, spent: 7, frozen: 2 }; // 2 points vanished
    expect(isIdentityValid(wrong)).toBe(false);
    expect(checkIdentity(wrong)).toBe(2);
  });

  it('F6: floating point noise does not break the identity', () => {
    const snap = computeSnapshot([earn(0.1), earn(0.2)]); // 0.30000000000000004 naively
    expect(snap.earned).toBe(0.3);
    expect(isIdentityValid(snap)).toBe(true);
  });

  it('F4: 累计获得 only grows, even after spending everything', () => {
    const r = applyEntries([], [earn(5), redeem(3), redeem(2)]);
    expect(r.snapshot.earned).toBe(5);
    expect(r.snapshot.available).toBe(0);
    expect(r.snapshot.spent).toBe(5);
    expect(isIdentityValid(r.snapshot)).toBe(true);
  });

  it('F7: spending more than the balance is refused before anything is written', () => {
    const entries = [earn(1)];
    expect(() => applyEntry(entries, redeem(2))).toThrow(LedgerError);
    expect(() => applyEntry(entries, redeem(2))).toThrow(/insufficient balance/);
    expect(entries).toHaveLength(1); // untouched
  });

  it('F7: spending the exact balance down to zero is allowed', () => {
    expect(applyEntries([], [earn(3), redeem(3)]).snapshot.available).toBe(0);
  });

  it('a reversal lowers 已消费 but never 累计获得 (F4, E8 overwrite path)', () => {
    const awarded = applyEntries([], [earn(3)]);
    const reversed = applyEntry(awarded.entries, buildReversal(3));

    expect(reversed.snapshot.earned).toBe(3);  // honour figure untouched
    expect(reversed.snapshot.spent).toBe(3);   // accounted as spending
    expect(reversed.snapshot.available).toBe(0);
    expect(isIdentityValid(reversed.snapshot)).toBe(true);
  });

  it('E8: re-settlement then re-award keeps the identity intact', () => {
    const awarded = applyEntries([], [earn(1.2)]);
    const reversed = applyEntry(awarded.entries, buildReversal(1.2));
    const reAwarded = applyEntry(reversed.entries, earn(3));

    expect(reAwarded.snapshot.available).toBe(3);
    expect(reAwarded.snapshot.earned).toBe(4.2); // 1.2 + 3, both were really earned
    expect(reAwarded.snapshot.spent).toBe(1.2);
    expect(isIdentityValid(reAwarded.snapshot)).toBe(true);
  });

  describe('C3 bounty lifecycle: a reservation, not a second pot of money', () => {
    it('holding reserves points without changing 可用 or 已消费', () => {
      const r = applyEntries([], [earn(10), buildBountyHold(8)]);
      expect(r.snapshot.available).toBe(10); // the money is still there...
      expect(r.snapshot.frozen).toBe(8);     // ...but 8 of it is reserved
      expect(spendable(r.snapshot)).toBe(2); // that is what can actually be spent
      expect(r.snapshot.spent).toBe(0);      // a reservation is not spending
      expect(r.snapshot.earned).toBe(10);
      expect(isIdentityValid(r.snapshot)).toBe(true);
    });

    it('reserved points cannot be spent a second time', () => {
      const held = applyEntries([], [earn(10), buildBountyHold(8)]);
      expect(spendable(held.snapshot)).toBe(2);
      // spending the free part is fine...
      expect(spendable(applyEntry(held.entries, redeem(2)).snapshot)).toBe(0);
      // ...but going past it would eat into the reservation, so it is refused
      expect(() => applyEntry(held.entries, redeem(5))).toThrow(/reserved points are not spendable/);
    });

    it('cannot reserve more than the member owns', () => {
      const entries = [earn(3)];
      expect(() => applyEntry(entries, buildBountyHold(5))).toThrow(/cannot hold 5 points/);
      expect(entries).toHaveLength(1);
    });

    it('an expired bounty releases the reservation, nothing else changes', () => {
      const held = applyEntries([], [earn(10), buildBountyHold(8)]);
      const refunded = applyEntry(held.entries, buildBountyRefund(8));

      expect(refunded.snapshot.available).toBe(10);
      expect(refunded.snapshot.frozen).toBe(0);
      expect(spendable(refunded.snapshot)).toBe(10); // spendable again
      expect(refunded.snapshot.earned).toBe(10);     // a refund is not earning
      expect(refunded.snapshot.spent).toBe(0);       // neither is it spending
      expect(isIdentityValid(refunded.snapshot)).toBe(true);
    });

    it('a completed bounty takes the reserved points out of the publisher', () => {
      const held = applyEntries([], [earn(10), buildBountyHold(8)]);
      const paid = applyEntry(held.entries, buildBountyPayout(8));

      expect(paid.snapshot.available).toBe(2);  // 10 - 8 left the publisher
      expect(paid.snapshot.frozen).toBe(0);     // reservation closed
      expect(paid.snapshot.spent).toBe(8);      // it is spending, not a magic disappearance
      expect(paid.snapshot.earned).toBe(10);    // the honour figure is untouched
      expect(isIdentityValid(paid.snapshot)).toBe(true);
    });

    it('releasing more than is reserved is refused', () => {
      const held = applyEntries([], [earn(10), buildBountyHold(4)]);
      expect(() => applyEntry(held.entries, buildBountyRefund(8))).toThrow(/frozen amount cannot go negative/);
    });

    it('the full bounty story adds up: publisher 10 -> worker gets 8, 2 left', () => {
      const publisher = applyEntries([], [earn(10), buildBountyHold(8)]);
      const closed = applyEntry(publisher.entries, buildBountyPayout(8));
      const worker = applyEntries([], [earn(8)]);

      expect(closed.snapshot.available).toBe(2);
      expect(worker.snapshot.available).toBe(8);
      expect(closed.snapshot.available + worker.snapshot.available).toBe(10); // conserved
    });
  });

  it('rejects nonsense rows instead of writing them', () => {
    expect(() => applyEntry([], { delta: 0, earned: true, reason: 'task_done' })).toThrow(/zero delta/);
    expect(() => applyEntry([], { delta: 5, earned: false, reason: 'redeem' })).toThrow(/must not increase/);
    expect(() => applyEntry([], { delta: -3, earned: false, reason: 'task_done' })).toThrow(/must be positive/);
    expect(() => applyEntry([], { delta: -3, earned: true, reason: 'admin_adjust' })).toThrow(/never be flagged as earned/);
  });

  it('the bounty builders refuse nonsense amounts', () => {
    expect(() => buildBountyHold(0)).toThrow(/must be positive/);
    expect(() => buildBountyRefund(-1)).toThrow(/must be positive/);
    expect(() => buildBountyPayout(0)).toThrow(/must be positive/);
    expect(() => buildReversal(0)).toThrow(/nothing to reverse/);
  });

  it('H8: the notification carries all three numbers', () => {
    const text = formatPointsNotice('弟弟', '洗碗', 1.2, {
      earned: 86.4,
      available: 42.4,
      spent: 44,
      frozen: 0,
    });
    expect(text).toContain('1.2');
    expect(text).toContain('累计获得 86.4');
    expect(text).toContain('可用 42.4');
    expect(text).toContain('已消费 44');
  });
});
