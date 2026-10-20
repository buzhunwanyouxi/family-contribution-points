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

/**
 * CONTRACTS #10b -- `GET /api/families/:fid/invite`.
 *
 * Only owner/admin may read it: the code is the family's front door, so a plain member asking for
 * it gets `403 role_not_allowed` (NOT `not_a_member` -- they are a member, and saying otherwise
 * would make them think the family disappeared).
 */
export interface FamilyInviteView {
  inviteCode: string;
  /** ISO-8601, or `null` when the family was created without an expiry. */
  inviteExpireAt: string | null;
  /** A URL a phone camera can act on directly: `.../join?code=<code>`. */
  qrPayload: string;
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

/**
 * CONTRACTS #15 -- exactly what the server sends.
 *
 * Deliberately NOT `PointsView`: the server returns four numbers, and `spendable` is a UI derivation
 * (`available - frozen`, F7). Keeping them as one type would make it look like the server sends five
 * values, and the first refactor would "helpfully" start reading `spendable` off the wire.
 */
export interface PointsResponse {
  earned: number;
  available: number;
  spent: number;
  frozen: number;
}

/** Turn a wire response into the shape the cards render. Same arithmetic as `toPointsView`. */
export function pointsResponseToView(response: PointsResponse): PointsView {
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    earned: round(response.earned),
    available: round(response.available),
    spent: round(response.spent),
    frozen: round(response.frozen),
    spendable: round(response.available - response.frozen),
  };
}

/**
 * CONTRACTS #16 -- one task instance as the list endpoint returns it.
 *
 * `date` is `YYYY-MM-DD` (a natural day, not an instant). `finalPercent`/`finalPoints` are null until
 * settlement, because writing them earlier would mean guessing.
 */
export interface InstanceSummary {
  id: string;
  templateId: string | null;
  title: string;
  date: string;
  maxPoints: number;
  status: InstanceStatus;
  deadlineAt: string;
  claimerId: string | null;
  claimedAt: string | null;
  autoAssigned: boolean;
  finalPercent: number | null;
  finalPoints: number | null;
}

/** Must match `apps/api/src/instances/types.ts`. The API rejects anything outside its table. */
export type InstanceStatus =
  | 'open'
  | 'claimed'
  | 'doing'
  | 'pending_score'
  | 'done'
  | 'rejected'
  | 'abandoned';

/** Chinese label for each status. Kept here so a page never invents its own wording. */
export const INSTANCE_STATUS_LABEL: Record<InstanceStatus, string> = {
  open: '待接',
  claimed: '已接',
  doing: '进行中',
  pending_score: '待评分',
  done: '已完成',
  rejected: '未通过',
  abandoned: '已放弃',
};
