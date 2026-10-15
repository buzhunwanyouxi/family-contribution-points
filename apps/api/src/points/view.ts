/**
 * CONTRACTS #15 -- `GET /api/families/:fid/points/:uid`: the member's four numbers.
 *
 * The whole job of this file is to **forward four numbers verbatim**. There is no arithmetic here on
 * purpose: PROJECT_GUIDE F5/F6 (v1.3) has exactly one implementation of the points semantics --
 * `apps/api/src/points/ledger.ts` -- and AGENTS.md section 5.1 makes a second one a hard error.
 *
 * Why a separate file for something this small: the temptation to "just add earned + frozen here" is
 * exactly the mistake this module exists to prevent, so the rule needs a place to live where it is
 * the first thing you read. `ledger.ts` owns the maths; this owns the wire shape.
 *
 * Invariant that must hold for every response (asserted in tests, not computed here):
 *     earnedPoints - spentPoints === points      (F5/F6 v1.3)
 *     frozenPoints is a reserved SUBSET of points, never added to it
 */
import { roundPoints } from './ledger.js';

/** The four numbers as stored on the member's `Membership` row. Mirrors `MembershipRecord`. */
export interface PointsSource {
  points: number;
  earnedPoints: number;
  spentPoints: number;
  frozenPoints: number;
}

/**
 * The frozen wire shape (CONTRACTS #15).
 *
 * `available` is the contract's name for the member's spendable-now balance; the database column is
 * `points`. The rename happens here and nowhere else, so the mapping is greppable.
 */
export interface PointsView {
  /** 累计获得 -- awarded minus reversals (F4) */
  earned: number;
  /** 当前可用 -- earnedPoints - spentPoints (F5) */
  available: number;
  /** 已消费 -- redeemed + contributed to wishes + bounty payouts (F5) */
  spent: number;
  /** 冻结中 -- reserved subset of `available`, NOT an extra balance (C3) */
  frozen: number;
}

/**
 * Build the response. Four plain copies, no maths.
 *
 * If you are about to write a calculation in this function, stop: either it belongs in `ledger.ts`
 * (if it is a real rule) or it does not belong anywhere (if you are "correcting" the stored values).
 */
export function toPointsView(source: PointsSource): PointsView {
  return {
    earned: roundPoints(source.earnedPoints),
    available: roundPoints(source.points),
    spent: roundPoints(source.spentPoints),
    frozen: roundPoints(source.frozenPoints),
  };
}
