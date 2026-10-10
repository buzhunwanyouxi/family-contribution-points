/**
 * Settlement core -- PROJECT_GUIDE section 4.5.
 *
 * Rules implemented here (do not "improve" them locally, the guide is the authority):
 *   E1  score is a 0-100 integer percentage
 *   E2  the family owner MUST score; other members MAY score
 *   E3  earned points = percentage x task max points
 *   E4  owner scored -> owner wins; otherwise average of the others
 *   E5  floor of 30% (below that it is a rejection, not a low score)
 *   E6  percentages are rounded to a 5% step
 *   E8  owner timeout -> settle with the others' average, owner may overwrite later
 *   E9  nobody scored -> fall back to 60%
 *
 * Pure functions only: no database, no clock, no side effects. Easy to unit test, and there is
 * exactly ONE implementation of the rule in the codebase.
 */
import {
  SCORE_FALLBACK_PERCENT,
  SCORE_FLOOR_PERCENT,
  SCORE_STEP_PERCENT,
} from '@fcp/shared';

export interface ScoreInput {
  scorerId: string;
  isOwner: boolean;
  percent: number;
}

export interface SettleInput {
  maxPoints: number;
  scores: ScoreInput[];
}

export type SettledBy = 'owner' | 'others_avg' | 'fallback_60';

export interface SettleResult {
  /** final 0-100 percentage actually used */
  percent: number;
  /** points granted to the claimer */
  points: number;
  /** which branch produced the number (E4 / E8 / E9) */
  settledBy: SettledBy;
  /** true when the outcome is provisional and an owner score may overwrite it (E8 / E9) */
  provisional: boolean;
  /** the raw average before rounding, for audit and UI transparency */
  rawPercent: number;
  /** number of non-owner scores taken into account */
  otherScorers: number;
}

export function roundToStep(value: number, step = SCORE_STEP_PERCENT): number {
  return Math.round(value / step) * step;
}

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(SCORE_FLOOR_PERCENT, value));
}

export function previewSettlement(input: SettleInput): SettleResult {
  const ownerScore = input.scores.find((s) => s.isOwner);
  const otherScores = input.scores.filter((s) => !s.isOwner);

  let rawPercent: number;
  let settledBy: SettledBy;
  let provisional = false;

  if (ownerScore) {
    rawPercent = ownerScore.percent;
    settledBy = 'owner';
  } else if (otherScores.length > 0) {
    rawPercent = otherScores.reduce((sum, s) => sum + s.percent, 0) / otherScores.length;
    settledBy = 'others_avg';
    provisional = true;
  } else {
    rawPercent = SCORE_FALLBACK_PERCENT;
    settledBy = 'fallback_60';
    provisional = true;
  }

  const percent = clampPercent(roundToStep(rawPercent));
  const points = roundPoints((percent / 100) * input.maxPoints);

  return {
    percent,
    points,
    settledBy,
    provisional,
    rawPercent,
    otherScorers: otherScores.length,
  };
}

/** points are kept to 2 decimals; a 3 point task at 40% must yield exactly 1.2 */
export function roundPoints(value: number): number {
  return Math.round(value * 100) / 100;
}