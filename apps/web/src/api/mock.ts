/**
 * Mock backend -- lets the UI run before lanes A and B land their endpoints.
 *
 * It deliberately keeps state in a module-level object (not localStorage) except for the session,
 * so a page reload gives you a clean slate. Delete this file only after every call in
 * `client.ts` has a real implementation behind it.
 */
import type {
  AuthResult,
  FamilyInviteView,
  FamilyResult,
  FamilySummary,
  InstanceSummary,
  MemberSummary,
  MeResult,
  PointsResponse,
  UserSummary,
} from './types';

interface MockUser extends UserSummary {
  password: string;
}

/** CONTRACTS「邀请码规范」: 6 chars, alphabet without 0/1/O/I, 7-day TTL. */
const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const INVITE_TTL_DAYS = 7;

function makeInviteCode(): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)];
  }
  return code;
}

const state: {
  users: MockUser[];
  sessionUserId: string | null;
  families: FamilySummary[];
  members: Record<string, MemberSummary[]>;
  invites: Record<string, FamilyInviteView>;
} = {
  users: [
    {
      id: 'u_demo',
      nickname: '演示用户',
      email: 'demo@example.com',
      phone: '13800000000',
      password: 'demo1234',
    },
  ],
  sessionUserId: null,
  families: [
    {
      id: 'f_demo',
      name: '演示家庭',
      role: 'owner',
      // 三个数字 + 冻结中:演示 F2 的展示口径
      points: 42.4,
      earnedPoints: 86.4,
      spentPoints: 44,
      frozenPoints: 5,
    },
  ],
  members: {
    f_demo: [
      { userId: 'u_demo', nickname: '演示用户', role: 'owner', joinedAt: '2026-03-01T09:00:00.000Z' },
      { userId: 'u_mom', nickname: '妈妈', role: 'admin', joinedAt: '2026-03-01T09:05:00.000Z' },
      { userId: 'u_bro', nickname: '哥哥', role: 'child', joinedAt: '2026-03-01T09:10:00.000Z' },
      { userId: 'u_didi', nickname: '弟弟', role: 'child', joinedAt: '2026-03-01T09:12:00.000Z' },
    ],
  },
  invites: {
    f_demo: {
      inviteCode: 'K7M2QP',
      inviteExpireAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString(),
      qrPayload: 'https://family-points.app/join?code=K7M2QP',
    },
  },
};

function publicUser(user: MockUser): UserSummary {
  const { password: _password, ...rest } = user;
  return rest;
}

function requireSession(): MockUser {
  const user = state.users.find((u) => u.id === state.sessionUserId);
  if (!user) throw new Error('未登录');
  return user;
}

function authResult(user: MockUser): AuthResult {
  state.sessionUserId = user.id;
  return {
    token: `mock-token.${user.id}.${Date.now()}`,
    user: publicUser(user),
    families: state.families,
  };
}

function findUserByAccount(account: string): MockUser | undefined {
  const value = account.trim().toLowerCase();
  return state.users.find(
    (u) => u.email?.toLowerCase() === value || u.phone === account.trim(),
  );
}

export async function register(input: {
  account: string;
  password: string;
  nickname: string;
}): Promise<AuthResult> {
  if (findUserByAccount(input.account)) {
    throw new Error('该手机号或邮箱已注册');
  }
  if (input.password.length < 6) {
    throw new Error('密码至少 6 位');
  }
  const isEmail = input.account.includes('@');
  const user: MockUser = {
    id: `u_${Math.random().toString(36).slice(2, 8)}`,
    nickname: input.nickname || input.account,
    password: input.password,
    ...(isEmail ? { email: input.account } : { phone: input.account }),
  };
  state.users.push(user);
  // A brand new account has no family yet: the UI must handle an empty list (contract rule 5).
  state.families = [];
  return authResult(user);
}

export async function login(input: { account: string; password: string }): Promise<AuthResult> {
  const user = findUserByAccount(input.account);
  if (!user || user.password !== input.password) {
    throw new Error('账号或密码不正确');
  }
  if (user.id !== 'u_demo') state.families = [];
  return authResult(user);
}

export async function me(): Promise<MeResult> {
  const user = requireSession();
  return { user: publicUser(user), families: state.families };
}

export async function createFamily(input: { name: string; timezone?: string }): Promise<FamilyResult> {
  const user = requireSession();
  const family: FamilySummary = {
    id: `f_${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    role: 'owner',
    points: 0,
    earnedPoints: 0,
    spentPoints: 0,
    frozenPoints: 0,
  };
  state.families = [...state.families, family];
  state.members[family.id] = [
    { userId: user.id, nickname: user.nickname, role: 'owner', joinedAt: new Date().toISOString() },
  ];
  // #10b: a new family gets its code immediately, so the invite card is populated right away.
  const inviteCode = makeInviteCode();
  state.invites[family.id] = {
    inviteCode,
    inviteExpireAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString(),
    qrPayload: `https://family-points.app/join?code=${inviteCode}`,
  };
  return { family, membership: { id: 'm_new', role: 'owner', joinedAt: new Date().toISOString() } };
}

export async function joinFamily(input: { inviteCode: string; nickname?: string }): Promise<FamilyResult> {
  const user = requireSession();
  if (input.inviteCode.trim().length < 4) {
    throw new Error('邀请码不正确');
  }
  const family: FamilySummary = {
    id: `f_${input.inviteCode.trim().toLowerCase()}`,
    name: `加入的家庭 ${input.inviteCode.trim().toUpperCase()}`,
    role: 'member',
    points: 0,
    earnedPoints: 0,
    spentPoints: 0,
    frozenPoints: 0,
  };
  if (!state.families.some((f) => f.id === family.id)) {
    state.families = [...state.families, family];
  }
  state.members[family.id] = state.members[family.id] ?? [
    { userId: user.id, nickname: user.nickname, role: 'member', joinedAt: new Date().toISOString() },
  ];
  return { family, membership: { id: 'm_join', role: 'member', joinedAt: new Date().toISOString() } };
}

export async function listFamilies(): Promise<{ families: FamilySummary[] }> {
  requireSession();
  return { families: state.families };
}

export async function members(familyId: string): Promise<{ members: MemberSummary[] }> {
  requireSession();
  return { members: state.members[familyId] ?? [] };
}

/**
 * CONTRACTS #10b. Mirrors the backend's authorisation: only owner/admin may read the code, and a
 * plain member gets the same `role_not_allowed` code so the UI path is exercised in mock mode too.
 */
export async function invite(familyId: string): Promise<FamilyInviteView> {
  const user = requireSession();
  const family = state.families.find((f) => f.id === familyId);
  if (!family) throw new Error('你不是这个家庭的成员');
  if (family.role !== 'owner' && family.role !== 'admin') {
    const error = new Error('只有家庭创建者可以分享邀请码,请让家长发给你');
    (error as Error & { code?: string }).code = 'role_not_allowed';
    throw error;
  }
  const existing = state.invites[familyId];
  if (existing) return existing;
  const inviteCode = makeInviteCode();
  const created: FamilyInviteView = {
    inviteCode,
    inviteExpireAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString(),
    qrPayload: `https://family-points.app/join?code=${inviteCode}`,
  };
  state.invites[familyId] = created;
  return created;
}

/**
 * CONTRACTS #15 -- the four numbers.
 *
 * Read from the mock family the session belongs to, so the page exercises the same code path in mock
 * mode. Note this returns the **wire** shape (four fields, no `spendable`) on purpose: `spendable` is
 * a UI derivation and the mock must not quietly become the place it comes from.
 */
export async function points(familyId: string, userId: string): Promise<PointsResponse> {
  const user = requireSession();
  if (user.id !== userId) {
    // Mirrors the real endpoint: a member may read a *sibling's* numbers, so this is not a permission
    // failure -- but the mock has no sibling accounts, so an unknown id means "not in this family".
    const error = new Error('你不是这个家庭的成员');
    (error as Error & { code?: string }).code = 'not_a_member';
    throw error;
  }
  const family = state.families.find((f) => f.id === familyId);
  if (!family) {
    const error = new Error('你不是这个家庭的成员');
    (error as Error & { code?: string }).code = 'not_a_member';
    throw error;
  }
  return {
    earned: family.earnedPoints,
    available: family.points,
    spent: family.spentPoints,
    frozen: family.frozenPoints,
  };
}

/**
 * CONTRACTS #16 -- one day's instances.
 *
 * Returns an empty list rather than inventing tasks: the mock cannot know what a family's template
 * would have generated, and fake tasks would make the "today" screen look finished when the real
 * generation job (M3) does not exist yet.
 */
export async function instances(
  familyId: string,
  _date: string,
): Promise<{ instances: InstanceSummary[] }> {
  requireSession();
  const family = state.families.find((f) => f.id === familyId);
  if (!family) {
    const error = new Error('你不是这个家庭的成员');
    (error as Error & { code?: string }).code = 'not_a_member';
    throw error;
  }
  return { instances: [] };
}

/** Test seam: reset the mock between runs. */
export function __resetMock(): void {
  state.sessionUserId = null;
}
