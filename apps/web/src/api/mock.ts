/**
 * Mock backend -- lets the UI run before lanes A and B land their endpoints.
 *
 * It deliberately keeps state in a module-level object (not localStorage) except for the session,
 * so a page reload gives you a clean slate. Delete this file only after every call in
 * `client.ts` has a real implementation behind it.
 */
import type {
  AuthResult,
  FamilyResult,
  FamilySummary,
  MemberSummary,
  MeResult,
  UserSummary,
} from './types';

interface MockUser extends UserSummary {
  password: string;
}

const state: {
  users: MockUser[];
  sessionUserId: string | null;
  families: FamilySummary[];
  members: Record<string, MemberSummary[]>;
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

/** Test seam: reset the mock between runs. */
export function __resetMock(): void {
  state.sessionUserId = null;
}
