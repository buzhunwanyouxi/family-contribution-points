/**
 * In-memory implementation of `FamilyRepository`.
 *
 * This is the default when no repository is injected, which is what keeps `pnpm --filter @fcp/api
 * test` and a fresh `pnpm dev` running with **zero database setup** (ADR-004 keeps sqlite for
 * development, but tests should not need a database file at all).
 *
 * It is a real implementation, not a mock: it enforces the same invariants the database does
 * (`(userId, familyId)` is unique, `inviteCode` is unique, a family always has exactly one owner
 * membership) so that a use case which passes here does not fail only in production.
 */
import { randomUUID } from 'node:crypto';
import type {
  AddMemberInput,
  CreateFamilyInput,
  FamilyRecord,
  FamilyRepository,
  MemberRow,
  MembershipRecord,
  MembershipWithFamily,
} from './types.js';

export interface InMemoryUser {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
}

export interface InMemoryFamilyRepositoryOptions {
  /** Accounts that already exist, so `listMembers` can resolve nicknames. */
  users?: InMemoryUser[];
  /** Injectable id factory -- pinned in tests so ids are readable and assertions are stable. */
  newId?: () => string;
}

export interface InMemoryFamilyRepository extends FamilyRepository {
  /** Test helper: inspect what landed in "storage" without going through a use case. */
  snapshot(): { families: FamilyRecord[]; memberships: MembershipRecord[] };
  /** Test helper: add an account without going through the auth module. */
  seedUser(user: InMemoryUser): void;
  /**
   * Test helper: pretend the points ledger has posted to a membership.
   *
   * Deliberately named `...ForTest`: this module must never write points itself (see `types.ts`),
   * so the only way to get non-zero numbers into a test is to say out loud that it is a fixture.
   * It is how the "four numbers are forwarded verbatim, never recomputed" rule is pinned.
   */
  setPointsForTest(
    userId: string,
    familyId: string,
    patch: Partial<
      Pick<MembershipRecord, 'points' | 'earnedPoints' | 'spentPoints' | 'frozenPoints'>
    >,
  ): void;
}

function cloneFamily(record: FamilyRecord): FamilyRecord {
  return { ...record };
}

function cloneMembership(record: MembershipRecord): MembershipRecord {
  return { ...record };
}

export function createInMemoryFamilyRepository(
  options: InMemoryFamilyRepositoryOptions = {},
): InMemoryFamilyRepository {
  const families = new Map<string, FamilyRecord>();
  const memberships: MembershipRecord[] = [];
  const users = new Map<string, InMemoryUser>();
  const newId = options.newId ?? (() => randomUUID());

  for (const user of options.users ?? []) {
    users.set(user.id, { ...user });
  }

  function join(family: FamilyRecord, membership: MembershipRecord): MembershipWithFamily {
    return { family: cloneFamily(family), membership: cloneMembership(membership) };
  }

  return {
    async createFamily(input: CreateFamilyInput): Promise<MembershipWithFamily> {
      if (families.has(input.inviteCode) || [...families.values()].some((f) => f.inviteCode === input.inviteCode)) {
        throw new Error(`duplicate invite code rejected: ${input.inviteCode}`);
      }
      if (!users.has(input.ownerId)) {
        throw new Error(`cannot create a family for an unknown user: ${input.ownerId}`);
      }

      const family: FamilyRecord = {
        id: newId(),
        name: input.name,
        ownerId: input.ownerId,
        inviteCode: input.inviteCode,
        inviteExpireAt: input.inviteExpireAt,
        timezone: input.timezone,
        createdAt: input.createdAt,
      };
      const membership: MembershipRecord = {
        id: newId(),
        userId: input.ownerId,
        familyId: family.id,
        // PROJECT_GUIDE A2 / 4.1: whoever creates the family is the owner, and the owner is the
        // only role allowed to write TaskTemplate rows (B1, enforced in the API layer).
        role: 'owner',
        points: 0,
        frozenPoints: 0,
        earnedPoints: 0,
        spentPoints: 0,
        // Creating a family *is* joining it, so both timestamps come from the caller's clock.
        joinedAt: input.createdAt,
      };

      families.set(family.id, family);
      memberships.push(membership);
      return join(family, membership);
    },

    async findFamilyById(familyId: string): Promise<FamilyRecord | null> {
      const family = families.get(familyId);
      return family === undefined ? null : cloneFamily(family);
    },

    async findFamilyByInviteCode(inviteCode: string): Promise<FamilyRecord | null> {
      for (const family of families.values()) {
        if (family.inviteCode === inviteCode) return cloneFamily(family);
      }
      return null;
    },

    async findMembership(userId: string, familyId: string): Promise<MembershipRecord | null> {
      const found = memberships.find((m) => m.userId === userId && m.familyId === familyId);
      return found === undefined ? null : cloneMembership(found);
    },

    async addMember(input: AddMemberInput): Promise<MembershipWithFamily> {
      const family = families.get(input.familyId);
      if (family === undefined) {
        throw new Error(`cannot add a member to an unknown family: ${input.familyId}`);
      }
      if (!users.has(input.userId)) {
        throw new Error(`cannot add an unknown user to a family: ${input.userId}`);
      }
      // Mirrors `@@unique([userId, familyId])`. The use case is supposed to have checked first;
      // tripping here means a caller changed without updating `join.ts`.
      if (memberships.some((m) => m.userId === input.userId && m.familyId === input.familyId)) {
        throw new Error('duplicate membership rejected: (userId, familyId) must be unique');
      }

      const membership: MembershipRecord = {
        id: newId(),
        userId: input.userId,
        familyId: input.familyId,
        role: input.role,
        points: 0,
        frozenPoints: 0,
        earnedPoints: 0,
        spentPoints: 0,
        joinedAt: input.joinedAt,
      };
      memberships.push(membership);
      return join(family, membership);
    },

    async listMemberships(userId: string): Promise<MembershipWithFamily[]> {
      return memberships
        .filter((m) => m.userId === userId)
        .map((m) => {
          const family = families.get(m.familyId);
          if (family === undefined) {
            throw new Error(`membership ${m.id} points at a missing family ${m.familyId}`);
          }
          return join(family, m);
        })
        .sort((a, b) => a.membership.joinedAt.getTime() - b.membership.joinedAt.getTime());
    },

    async listMembers(familyId: string): Promise<MemberRow[]> {
      const rows: MemberRow[] = [];
      for (const membership of memberships) {
        if (membership.familyId !== familyId) continue;
        const user = users.get(membership.userId);
        if (user === undefined) {
          throw new Error(`membership ${membership.id} points at a missing user ${membership.userId}`);
        }
        rows.push({
          userId: user.id,
          nickname: user.nickname,
          avatarUrl: user.avatarUrl ?? null,
          role: membership.role,
          joinedAt: membership.joinedAt,
        });
      }
      // Owner first, then by join order: the family page reads better with 爸爸/妈妈 at the top.
      const rank: Record<string, number> = { owner: 0, admin: 1, member: 2, child: 3 };
      return rows.sort((a, b) => {
        const byRole = (rank[a.role] ?? 9) - (rank[b.role] ?? 9);
        if (byRole !== 0) return byRole;
        return a.joinedAt.getTime() - b.joinedAt.getTime();
      });
    },

    async findUser(userId: string): Promise<{ id: string; nickname: string } | null> {
      const user = users.get(userId);
      return user === undefined ? null : { id: user.id, nickname: user.nickname };
    },

    async updateUserNickname(userId: string, nickname: string): Promise<void> {
      const user = users.get(userId);
      if (user === undefined) throw new Error(`cannot rename an unknown user: ${userId}`);
      user.nickname = nickname;
    },

    async isInviteCodeTaken(inviteCode: string): Promise<boolean> {
      return [...families.values()].some((f) => f.inviteCode === inviteCode);
    },

    snapshot() {
      return {
        families: [...families.values()].map(cloneFamily),
        memberships: memberships.map(cloneMembership),
      };
    },

    seedUser(user: InMemoryUser) {
      users.set(user.id, { ...user });
    },

    setPointsForTest(userId, familyId, patch) {
      const membership = memberships.find((m) => m.userId === userId && m.familyId === familyId);
      if (membership === undefined) {
        throw new Error(`no membership for (${userId}, ${familyId}) to attach points to`);
      }
      Object.assign(membership, patch);
    },
  };
}
