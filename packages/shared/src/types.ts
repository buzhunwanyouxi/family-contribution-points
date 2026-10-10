/** Domain types shared by the api and the web client. SHARED FILE. */

export type Role = 'owner' | 'admin' | 'member' | 'child';

/**
 * TaskInstance.status -- the state machine flows one way (PROJECT_GUIDE 7.1).
 * Persisted identifiers are ASCII; Chinese labels live in the UI dictionary.
 */
export type InstanceStatus =
  | 'open'
  | 'claimed'
  | 'doing'
  | 'pending_score'
  | 'done'
  | 'rejected'
  | 'abandoned';

export type SettledBy = 'owner' | 'others_avg' | 'fallback_60';

export type PointsReason =
  | 'task_done'
  | 'bounty_hold'
  | 'bounty_refund'
  | 'bounty_payout'
  | 'wish_contribute'
  | 'redeem'
  | 'reverse'
  | 'admin_adjust';

export type ProofMediaStatus = 'valid' | 'expired';

export type DisciplineType = 'no_show' | 'abandoned' | 'rejected' | 'damaged';

/**
 * The three numbers the product must always show together (PROJECT_GUIDE F2).
 * Identity that must always hold (F6): earned - spent - frozen === available
 */
export interface PointsSnapshot {
  /** 累计获得 / cumulative earned - never decreases */
  earned: number;
  /** 当前可用 / current available - spendable, includes frozen */
  available: number;
  /** 已消费 / spent - redeemed + contributed to wishes */
  spent: number;
  /** 冻结中 / frozen - held for open bounties */
  frozen: number;
}

export interface ProofMediaRef {
  id: string;
  type: 'image' | 'video';
  url: string;
  thumbUrl?: string;
  /** when the file disappears (upload time + PROOF_TTL_HOURS) */
  expireAt: string;
  status: ProofMediaStatus;
}

/** A score submitted by one family member for one instance (0-100). */
export interface ScoreRef {
  scorerId: string;
  isOwner: boolean;
  percent: number;
}

/** UI labels for the persisted status codes. Keep Chinese out of the database. */
export const INSTANCE_STATUS_LABEL: Record<InstanceStatus, string> = {
  open: '待接取',
  claimed: '已接取',
  doing: '进行中',
  pending_score: '待评分',
  done: '已完成',
  rejected: '已驳回',
  abandoned: '已放弃',
};
