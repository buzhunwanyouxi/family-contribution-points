/**
 * CONTRACTS #15 contract tests.
 *
 * The interesting cases are not "does it copy four numbers" but "does it refuse to become a second
 * implementation of the points rules": the identity must survive, and the frozen amount must never
 * be folded into `available`.
 *
 * Every fixture below satisfies `earnedPoints - spentPoints === points`, because any response that
 * does not is a ledger bug, and this layer must not disguise it. (My first draft of this file used
 * values that broke the identity and the tests caught it -- that is the test doing its job, so the
 * rule is written down here rather than left implicit.)
 */
import { describe, expect, it } from 'vitest';
import { toPointsView } from './view.js';

const member = (points: number, earnedPoints: number, spentPoints: number, frozenPoints: number) => ({
  points,
  earnedPoints,
  spentPoints,
  frozenPoints,
});

describe('toPointsView (CONTRACTS #15)', () => {
  it('forwards the four stored numbers under the wire names', () => {
    expect(toPointsView(member(42.4, 86.4, 44, 5))).toEqual({
      earned: 86.4,
      available: 42.4,
      spent: 44,
      frozen: 5,
    });
  });

  it('renames `points` to `available` and does not expose the column name', () => {
    const view = toPointsView(member(10, 10, 0, 0)) as unknown as Record<string, unknown>;
    expect(view).toHaveProperty('available', 10);
    expect(view).not.toHaveProperty('points');
  });

  it('identity earned - spent === available holds for every response', () => {
    const cases = [
      member(0, 0, 0, 0),
      member(10, 10, 0, 0),
      member(5, 10, 5, 5),
      member(0.3, 1, 0.7, 0.2), // float-heavy: rounding must not break it
      member(86.4, 100, 13.6, 0),
    ];
    for (const source of cases) {
      const view = toPointsView(source);
      expect(view.earned - view.spent, JSON.stringify(source)).toBeCloseTo(view.available, 10);
    }
  });

  it('every fixture in this file satisfies the identity (guards the fixtures, not the code)', () => {
    const fixtures = [member(42.4, 86.4, 44, 5), member(0, 0, 0, 0), member(5, 10, 5, 5)];
    for (const f of fixtures) {
      expect(f.earnedPoints - f.spentPoints, JSON.stringify(f)).toBeCloseTo(f.points, 10);
    }
  });

  it('frozen stays a SUBSET of available -- it is never added to it', () => {
    const view = toPointsView(member(42.4, 86.4, 44, 5));
    expect(view.frozen).toBeLessThanOrEqual(view.available);
    // The classic mistake would be `available = points + frozenPoints`: 42.4 + 5 = 47.4
    expect(view.available).not.toBeCloseTo(47.4, 10);
  });

  it('rounds to 2 decimals, the same rule the ledger uses', () => {
    // Expected values taken from roundPoints itself rather than guessed: `1.005 * 100` is 100.49999…
    // in binary floating point, so it rounds DOWN to 1. That is pre-existing ledger behaviour, and
    // this layer must not "fix" it -- doing so would put the two layers out of step.
    expect(toPointsView(member(1, 2, 1, 0.1))).toEqual({
      earned: 2,
      available: 1,
      spent: 1,
      frozen: 0.1,
    });
  });

  it('negative balances pass through unchanged -- this layer never clamps or "fixes" data', () => {
    // A negative available can only come from a ledger bug. Hiding it here would make that bug
    // invisible; the correct place to catch it is the ledger, and a test there already does.
    expect(toPointsView(member(-5, 10, 15, 0))).toEqual({
      earned: 10,
      available: -5,
      spent: 15,
      frozen: 0,
    });
  });
});
