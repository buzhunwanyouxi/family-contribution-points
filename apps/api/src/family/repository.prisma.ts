/**
 * Prisma adapter for the family persistence port -- the real database implementation.
 *
 * Deliberately STRUCTURAL: it does not import `@prisma/client`, so
 *   - `pnpm -r typecheck` stays green before `pnpm db:generate` has ever run, and
 *   - this module never depends on the generated client (which is gitignored).
 * Lane A's `auth/repository.prisma.ts` makes the same choice for the same reason.
 *
 * Wiring it up is one object, once lane A's `registerAuth` has landed:
 *
 *   const prisma = new PrismaClient();
 *   await registerFamily(app, { repository: createPrismaFamilyRepository(prisma) });
 *
 * The delegate surface below is exactly the subset of `prisma.family` / `prisma.membership` /
 * `prisma.user` this module uses. Changing `schema.prisma` in a way that breaks any of them is a
 * contract change -- `schema.prisma` is a shared file, so say so in the ops log and in CONTRACTS.md.
 */
import type {
  AddMemberInput,
  CreateFamilyInput,
  FamilyRecord,
  FamilyRepository,
  MemberRow,
  MembershipRecord,
  MembershipWithFamily,
  Role,
} from './types.js';

/** `model Family` as Prisma returns it. */
export interface PrismaFamilyRow {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  inviteExpireAt: Date | null;
  timezone: string;
  createdAt: Date;
}

/** `model Membership` as Prisma returns it. */
export interface PrismaMembershipRow {
  id: string;
  userId: string;
  familyId: string;
  role: string;
  points: number;
  frozenPoints: number;
  earnedPoints: number;
  spentPoints: number;
  joinedAt: Date;
}

export interface PrismaUserRow {
  id: string;
  nickname: string;
  avatarUrl: string | null;
}

type MembershipWithRelations = PrismaMembershipRow & {
  family?: PrismaFamilyRow;
  user?: PrismaUserRow;
};

/** Prisma's unique-constraint violation code. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

export interface PrismaFamilyDelegate {
  create(args: {
    data: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<PrismaFamilyRow & { memberships?: PrismaMembershipRow[] }>;
  findUnique(args: {
    where: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<(PrismaFamilyRow & { memberships?: PrismaMembershipRow[] }) | null>;
  findFirst(args: {
    where: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<PrismaFamilyRow | null>;
}

export interface PrismaMembershipDelegate {
  findFirst(args: {
    where: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<MembershipWithRelations | null>;
  findMany(args: {
    where: Record<string, unknown>;
    include?: Record<string, unknown>;
    orderBy?: unknown;
  }): Promise<MembershipWithRelations[]>;
  create(args: {
    data: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<MembershipWithRelations>;
}

export interface PrismaUserDelegate {
  findUnique(args: { where: Record<string, unknown> }): Promise<PrismaUserRow | null>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<PrismaUserRow>;
}

/** Structural `PrismaClient` -- pass the real client, it satisfies this shape. */
export interface PrismaLikeClient {
  family: PrismaFamilyDelegate;
  membership: PrismaMembershipDelegate;
  user: PrismaUserDelegate;
}

function toFamilyRecord(row: PrismaFamilyRow): FamilyRecord {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    inviteCode: row.inviteCode,
    inviteExpireAt: row.inviteExpireAt,
    timezone: row.timezone,
    createdAt: row.createdAt,
  };
}

function toMembershipRecord(row: PrismaMembershipRow): MembershipRecord {
  return {
    id: row.id,
    userId: row.userId,
    familyId: row.familyId,
    role: row.role as Role,
    // Verbatim, never recomputed -- see the note in `types.ts`.
    points: row.points,
    frozenPoints: row.frozenPoints,
    earnedPoints: row.earnedPoints,
    spentPoints: row.spentPoints,
    joinedAt: row.joinedAt,
  };
}

export function createPrismaFamilyRepository(client: PrismaLikeClient): FamilyRepository {
  return {
    async createFamily(input: CreateFamilyInput): Promise<MembershipWithFamily> {
      try {
        // A nested create is atomic in Prisma: the family and its owner membership are written in
        // one statement, so "a family without an owner" is not a reachable state.
        const family = await client.family.create({
          data: {
            name: input.name,
            ownerId: input.ownerId,
            inviteCode: input.inviteCode,
            inviteExpireAt: input.inviteExpireAt,
            timezone: input.timezone,
            createdAt: input.createdAt,
            memberships: {
              create: { userId: input.ownerId, role: 'owner', joinedAt: input.createdAt },
            },
          },
          include: { memberships: true },
        });

        const membership = family.memberships?.find((m) => m.userId === input.ownerId);
        if (membership === undefined) {
          throw new Error(
            `nested create did not return an owner membership for family ${family.id}; ` +
              'check the `include` clause against schema.prisma',
          );
        }
        return { family: toFamilyRecord(family), membership: toMembershipRecord(membership) };
      } catch (error) {
        // The caller pre-checks uniqueness, so reaching this means two requests raced. Surfacing
        // it as a distinct message beats a bare P2002 in the server log.
        if (isUniqueViolation(error)) {
          throw new Error(`invite code ${input.inviteCode} was taken between check and insert`);
        }
        throw error;
      }
    },

    async findFamilyById(familyId: string): Promise<FamilyRecord | null> {
      const row = await client.family.findUnique({ where: { id: familyId } });
      return row === null ? null : toFamilyRecord(row);
    },

    async findFamilyByInviteCode(inviteCode: string): Promise<FamilyRecord | null> {
      // `findFirst` rather than `findUnique`: the structural delegate stays free of Prisma's
      // generated `FamilyWhereUniqueInput` union while behaving identically on a unique column.
      const row = await client.family.findFirst({ where: { inviteCode } });
      return row === null ? null : toFamilyRecord(row);
    },

    async findMembership(userId: string, familyId: string): Promise<MembershipRecord | null> {
      const row = await client.membership.findFirst({ where: { userId, familyId } });
      return row === null ? null : toMembershipRecord(row);
    },

    async addMember(input: AddMemberInput): Promise<MembershipWithFamily> {
      const row = await client.membership.create({
        data: {
          familyId: input.familyId,
          userId: input.userId,
          role: input.role,
          joinedAt: input.joinedAt,
        },
      });
      const family = await client.family.findUnique({ where: { id: input.familyId } });
      if (family === null) {
        throw new Error(`family ${input.familyId} disappeared while adding a member`);
      }
      return { family: toFamilyRecord(family), membership: toMembershipRecord(row) };
    },

    async listMemberships(userId: string): Promise<MembershipWithFamily[]> {
      const rows = await client.membership.findMany({
        where: { userId },
        include: { family: true },
        orderBy: { joinedAt: 'asc' },
      });
      return rows.map((row) => {
        if (row.family === undefined) {
          throw new Error(`membership ${row.id} came back without its family; check the include`);
        }
        return { family: toFamilyRecord(row.family), membership: toMembershipRecord(row) };
      });
    },

    async listMembers(familyId: string): Promise<MemberRow[]> {
      const rows = await client.membership.findMany({
        where: { familyId },
        include: { user: true },
      });
      const mapped = rows.map((row) => {
        if (row.user === undefined) {
          throw new Error(`membership ${row.id} came back without its user; check the include`);
        }
        return {
          userId: row.user.id,
          nickname: row.user.nickname,
          avatarUrl: row.user.avatarUrl,
          role: row.role as Role,
          joinedAt: row.joinedAt,
        };
      });
      const rank: Record<string, number> = { owner: 0, admin: 1, member: 2, child: 3 };
      return mapped.sort((a, b) => {
        const byRole = (rank[a.role] ?? 9) - (rank[b.role] ?? 9);
        if (byRole !== 0) return byRole;
        return a.joinedAt.getTime() - b.joinedAt.getTime();
      });
    },

    async findUser(userId: string): Promise<{ id: string; nickname: string } | null> {
      const row = await client.user.findUnique({ where: { id: userId } });
      return row === null ? null : { id: row.id, nickname: row.nickname };
    },

    async updateUserNickname(userId: string, nickname: string): Promise<void> {
      await client.user.update({ where: { id: userId }, data: { nickname } });
    },

    async isInviteCodeTaken(inviteCode: string): Promise<boolean> {
      const row = await client.family.findFirst({ where: { inviteCode } });
      return row !== null;
    },
  };
}
