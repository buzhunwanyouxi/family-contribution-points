/**
 * Domain types and the persistence port for the `family` module (lane B, W1-03..W1-06).
 *
 * The wire shapes below are frozen by `docs/CONTRACTS.md` section 2 ("前端调用约定") and are
 * already coded into `apps/web/src/api/types.ts`; nothing in this module may drift from them.
 *
 * They are declared LOCALLY rather than imported from `apps/api/src/auth/types.ts`, and that is a
 * deliberate, documented decision: lane A's auth module lived on `feat/auth-register` (PR #1) and
 * had not reached `main` when this module was written, so importing it would have made lane B
 * impossible to typecheck or merge on its own. `http.test.ts` pins the exact field sets so the two
 * declarations cannot drift apart silently. See this round's ops log, section 3.
 */

/**
 * `Membership.role` in `prisma/schema.prisma` is a plain string column holding these ASCII codes
 * (the schema deliberately keeps persisted identifiers ASCII; Chinese lives in the UI layer).
 */
export type Role = 'owner' | 'admin' | 'member' | 'child';

/**
 * One row of the family switcher. CONTRACTS rule 6: the four numbers must ALWAYS travel together.
 *
 * They are forwarded from `Membership` verbatim -- this module must never compute, round or
 * otherwise "improve" them. The single source of truth for the points semantics is
 * `apps/api/src/points/ledger.ts` (F5/F6 v1.3):
 *
 *   points       = 当前可用 = earnedPoints - spentPoints   (the `Membership.points` column)
 *   earnedPoints = 累计获得
 *   spentPoints  = 已消费
 *   frozenPoints = 冻结中, a reserved SUBSET of `points` (spendable = points - frozenPoints)
 */
export interface FamilySummary {
  id: string;
  name: string;
  role: Role;
  points: number;
  earnedPoints: number;
  spentPoints: number;
  frozenPoints: number;
}

/** CONTRACTS #9 -- one row of the member list (P12). */
export interface MemberSummary {
  userId: string;
  nickname: string;
  /** Omitted when absent, never `null`: the frozen frontend type is `avatarUrl?: string`. */
  avatarUrl?: string;
  role: Role;
  /** ISO-8601 string; `Date` objects are not JSON-serialised the way the contract promises. */
  joinedAt: string;
}

/** The `membership` half of CONTRACTS #6 / #7. */
export interface MembershipSummary {
  id: string;
  role: Role;
  joinedAt: string;
}

/** CONTRACTS #6 (`POST /api/families`) and #7 (`POST /api/families/join`). */
export interface FamilyResult {
  family: FamilySummary;
  membership: MembershipSummary;
}

/* ------------------------------------------------------------------------------------------------
 * Persistence rows -- mirrors of the tables in `apps/api/prisma/schema.prisma`
 * ---------------------------------------------------------------------------------------------- */

/** `model Family` */
export interface FamilyRecord {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  inviteExpireAt: Date | null;
  timezone: string;
  createdAt: Date;
}

/** `model Membership` (the `user` / `family` relations are resolved through the repository). */
export interface MembershipRecord {
  id: string;
  userId: string;
  familyId: string;
  role: Role;
  points: number;
  frozenPoints: number;
  earnedPoints: number;
  spentPoints: number;
  joinedAt: Date;
}

/** A membership joined with its family -- what both `GET /api/families` and lane A's port need. */
export interface MembershipWithFamily {
  family: FamilyRecord;
  membership: MembershipRecord;
}

/** A member row joined with the account it belongs to. */
export interface MemberRow {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  role: Role;
  joinedAt: Date;
}

export interface CreateFamilyInput {
  name: string;
  timezone: string;
  ownerId: string;
  /** Resolved by the caller (see `invite.ts`) so both repository implementations agree. */
  inviteCode: string;
  inviteExpireAt: Date | null;
  /**
   * The instant the family was created, supplied by the caller's injectable clock rather than
   * read from `new Date()` inside the repository. Without this, a test with a frozen clock would
   * still get wall-clock timestamps and could not assert on `joinedAt` at all.
   * The owner's `joinedAt` is the same instant: creating a family *is* joining it.
   */
  createdAt: Date;
}

export interface AddMemberInput {
  familyId: string;
  userId: string;
  role: Role;
  joinedAt: Date;
}

/* ------------------------------------------------------------------------------------------------
 * The persistence port -- the single seam that lets the same use cases run on memory or on Prisma
 * ---------------------------------------------------------------------------------------------- */

/**
 * Two implementations exist and both satisfy this interface, so `create.ts` / `join.ts` /
 * `members.ts` never change when storage changes:
 *   - `createInMemoryFamilyRepository()`    (repository.ts)        -- dev / unit tests, zero setup
 *   - `createPrismaFamilyRepository(client)` (repository.prisma.ts) -- real rows
 *
 * The shared rule: **no points arithmetic happens here or anywhere else in this module.**
 * `Membership.points / earnedPoints / spentPoints / frozenPoints` are read and forwarded.
 */
export interface FamilyRepository {
  /** Persists `Family` + the owner's `Membership` as one unit, or persists nothing at all. */
  createFamily(input: CreateFamilyInput): Promise<MembershipWithFamily>;
  findFamilyById(familyId: string): Promise<FamilyRecord | null>;
  /** Used to resolve `POST /api/families/join`; the caller has already normalised the code. */
  findFamilyByInviteCode(inviteCode: string): Promise<FamilyRecord | null>;
  findMembership(userId: string, familyId: string): Promise<MembershipRecord | null>;
  addMember(input: AddMemberInput): Promise<MembershipWithFamily>;
  /** `GET /api/families` and lane A's `FamilyDirectoryPort` both read through this. */
  listMemberships(userId: string): Promise<MembershipWithFamily[]>;
  listMembers(familyId: string): Promise<MemberRow[]>;
  /** `join` may optionally rename the account; see `join.ts` for why that is a global change. */
  findUser(userId: string): Promise<{ id: string; nickname: string } | null>;
  updateUserNickname(userId: string, nickname: string): Promise<void>;
  /** Whether an invite code is already taken (keeps generated codes unique). */
  isInviteCodeTaken(inviteCode: string): Promise<boolean>;
}

/** Injectable clock; every use case that cares about "now" takes one so tests are deterministic. */
export type Clock = () => Date;

/** Injectable random source for invite codes (`() => number` in `[0, 1)`, like `Math.random`). */
export type RandomSource = () => number;
