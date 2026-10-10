/** Domain types shared by the api and the web client. SHARED FILE. */

export type Role = 'owner' | 'admin' | 'member' | 'child';

export type InstanceStatus =
  | '寰呮帴鍙?
  | '宸叉帴鍙?
  | '杩涜涓?
  | '寰呰瘎鍒?
  | '宸插畬鎴?
  | '宸查┏鍥?
  | '宸叉斁寮?;

export type SettledBy = 'owner' | 'others_avg' | 'fallback_60';

export type PointsReason =
  | '浠诲姟瀹屾垚'
  | '鎮祻鏀嚭'
  | '鎮祻閫€鍥?
  | '鎰挎湜鎶曞叆'
  | '鍏戞崲'
  | '鍐叉'
  | '绠＄悊鍛樿皟鏁?;

/**
 * The three numbers the product must always show together (PROJECT_GUIDE F2).
 * Identity that must always hold (F6): earned - spent - frozen === available
 */
export interface PointsSnapshot {
  /** 绱鑾峰緱 - cumulative earned, never decreases */
  earned: number;
  /** 褰撳墠鍙敤 - spendable balance including frozen */
  available: number;
  /** 宸叉秷璐?- redeemed + contributed to wishes */
  spent: number;
  /** 鍐荤粨涓?- held for open bounties */
  frozen: number;
}

export interface ProofMediaRef {
  id: string;
  type: 'image' | 'video';
  url: string;
  thumbUrl?: string;
  /** when the file disappears (upload time + PROOF_TTL_HOURS) */
  expireAt: string;
  status: '鏈夋晥' | '宸茶繃鏈?;
}