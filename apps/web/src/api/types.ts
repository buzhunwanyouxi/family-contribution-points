/**
 * Wire types for the API -- mirrors docs/CONTRACTS.md section "前端调用约定".
 *
 * These are the shapes lanes A and B must return. They live in the web app for now and will be
 * hoisted into packages/shared once all three lanes agree (see the ops log for W1-C).
 */

/** One field that accepts either a phone number or an email address. */
export type Account = string;

export type Role = 'owner' | 'admin' | 'member' | 'child';

export interface UserSummary {
  id: string;
  nickname: string;
  avatarUrl?: string;
  phone?: string;
  email?: string;
}

export interface FamilySummary {
  id: string;
  name: string;
  role: Role;
  /** 当前可用 = earnedPoints - spentPoints; `frozenPoints` is a reserved subset of it (F2/F6) */
  points: number;
  /** 累计获得 -- awarded minus reversals; only E8 reversals can lower it (F4) */
  earnedPoints: number;
  /** 已消费 -- redeemed + contributed to wishes + bounty payouts (F5) */
  spentPoints: number;
  /** 冻结中 -- reserved subset of `points` for this member's open bounties (C3) */
  frozenPoints: number;
}

export interface MemberSummary {
  userId: string;
  nickname: string;
  avatarUrl?: string;
  role: Role;
  joinedAt: string;
}

export interface AuthResult {
  token: string;
  user: UserSummary;
  families: FamilySummary[];
}

export interface FamilyResult {
  family: FamilySummary;
  membership: { id: string; role: Role; joinedAt: string };
}

export interface MeResult {
  user: UserSummary;
  families: FamilySummary[];
}

export interface ErrorBody {
  /** stable machine code, e.g. `user_exists` / `invalid_credentials` / `validation_error` */
  error: string;
  /**
   * Optional human-readable text (lane A sends Chinese). Additive on top of the frozen
   * `{error, details?}` shape -- always fall back to `error` when it is absent.
   */
  message?: string;
  details?: unknown;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: '创始人',
  admin: '管理员',
  member: '成员',
  child: '子女',
};

/** The three numbers the UI must always show together (F2). */
export interface PointsView {
  earned: number;
  available: number;
  spent: number;
  frozen: number;
  /** available - frozen: what can actually be spent right now (F7) */
  spendable: number;
}

export function toPointsView(family: FamilySummary): PointsView {
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    earned: round(family.earnedPoints),
    available: round(family.points),
    spent: round(family.spentPoints),
    frozen: round(family.frozenPoints),
    spendable: round(family.points - family.frozenPoints),
  };
}
