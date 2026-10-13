/**
 * Use cases for the `family` module: create / join / list families / list members.
 *
 * The HTTP layer does shape checks (zod) and nothing else; every rule lives here, so `create.ts`
 * and `routes/family.ts` can never disagree about what a valid family is.
 *
 * **The one rule that matters most in this file** is `toFamilySummary`: the four points numbers
 * are copied straight out of `Membership` and never computed. `PROJECT_GUIDE` F5/F6 (v1.3) has
 * exactly one implementation of the points semantics -- `apps/api/src/points/ledger.ts` -- and
 * AGENTS.md section 5.1 makes a second one a hard error. If you are ever tempted to "just add
 * earnedPoints + frozenPoints" here, don't: read the guide first.
 */
import { FamilyError } from './errors.js';
import {
  createCryptoRandom,
  generateUniqueInviteCode,
  isInviteExpired,
  isWellFormedInviteCode,
  normalizeInviteCode,
  resolveInviteExpiry,
  resolveInviteTtlDays,
} from './invite.js';
import { createInMemoryFamilyRepository } from './repository.js';
import type {
  Clock,
  FamilyRecord,
  FamilyRepository,
  FamilyResult,
  FamilySummary,
  MemberSummary,
  MembershipRecord,
  MembershipWithFamily,
  RandomSource,
  Role,
} from './types.js';

/** PROJECT_GUIDE A2 + the shipped form: `maxLength={20}` in `FamilySetupPage.tsx`. */
export const FAMILY_NAME_MAX_LENGTH = 20;

/**
 * ⚠️ DELIBERATE DUPLICATION, flagged for the next round: the canonical nickname policy lives in
 * `apps/api/src/auth/identifiers.ts` (`NICKNAME_MAX_LENGTH`). It is not imported because lane A's
 * module was not on `main` when this file was written (see the ops log). `POST /api/families/join`
 * carries an optional `nickname`, and today's UI never sends it, so the blast radius is nil --
 * but once lane A has landed this constant should be replaced by the imported one.
 */
export const NICKNAME_MAX_LENGTH = 24;

export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

export interface CreateFamilyRequest {
  name: string;
  timezone?: string;
}

export interface JoinFamilyRequest {
  inviteCode: string;
  nickname?: string;
}

export interface FamilyService {
  createFamily(userId: string, input: CreateFamilyRequest): Promise<FamilyResult>;
  joinFamily(userId: string, input: JoinFamilyRequest): Promise<FamilyResult>;
  /**
   * CONTRACTS #8. This is also exactly the shape lane A's `FamilyDirectoryPort` wants, so
   * `directory.ts` reuses it instead of adding a parallel method.
   */
  listFamilies(userId: string): Promise<FamilySummary[]>;
  /** CONTRACTS #9. Throws `not_a_member` unless `userId` belongs to `familyId`. */
  listMembers(userId: string, familyId: string): Promise<MemberSummary[]>;
}

export interface CreateFamilyServiceOptions {
  /** Defaults to the in-memory repository so a fresh clone runs with zero database setup. */
  repository?: FamilyRepository;
  clock?: Clock;
  random?: RandomSource;
  env?: Record<string, string | undefined>;
}

/**
 * Forwards the four numbers verbatim. See the file header: no arithmetic belongs here.
 *
 * `role` is an untyped `string` in the database (`Membership.role`), so it is narrowed on the way
 * out; anything unexpected would be a data bug rather than a valid wire value.
 */
export function toFamilySummary(entry: MembershipWithFamily): FamilySummary {
  const { family, membership } = entry;
  return {
    id: family.id,
    name: family.name,
    role: asRole(membership.role),
    points: membership.points,
    earnedPoints: membership.earnedPoints,
    spentPoints: membership.spentPoints,
    frozenPoints: membership.frozenPoints,
  };
}

export function toMemberSummary(row: {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  role: Role;
  joinedAt: Date;
}): MemberSummary {
  const summary: MemberSummary = {
    userId: row.userId,
    nickname: row.nickname,
    role: row.role,
    joinedAt: row.joinedAt.toISOString(),
  };
  // Omitted, not `null`: the frozen frontend type is `avatarUrl?: string` and `null` is not
  // assignable to it. Lane A's `mapper.ts` makes the same call for the same reason.
  if (row.avatarUrl !== null) summary.avatarUrl = row.avatarUrl;
  return summary;
}

const ROLES: readonly Role[] = ['owner', 'admin', 'member', 'child'];

function asRole(value: string): Role {
  return (ROLES as readonly string[]).includes(value) ? (value as Role) : 'member';
}

/**
 * Normalises and validates the family name. Returns the cleaned value so the caller stores what it
 * validated, instead of validating one string and persisting another.
 */
export function normalizeFamilyName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) {
    throw FamilyError.validation({ field: 'name', reason: 'empty' });
  }
  if ([...name].length > FAMILY_NAME_MAX_LENGTH) {
    throw FamilyError.validation({
      field: 'name',
      reason: 'too_long',
      max: FAMILY_NAME_MAX_LENGTH,
    });
  }
  return name;
}

/** Accepts an IANA zone name; falls back to the schema default (ADR: sqlite stores it as text). */
export function normalizeTimezone(raw: string | undefined): string {
  if (raw === undefined) return DEFAULT_TIMEZONE;
  const zone = raw.trim();
  if (zone.length === 0) return DEFAULT_TIMEZONE;
  try {
    // Throws `RangeError` for an unknown zone -- a cheap, dependency-free validity check.
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    throw FamilyError.validation({ field: 'timezone', reason: 'unknown_zone' });
  }
}

function normalizeNickname(raw: string): string {
  const nickname = raw.trim();
  if (nickname.length === 0) {
    throw FamilyError.validation({ field: 'nickname', reason: 'empty' });
  }
  if ([...nickname].length > NICKNAME_MAX_LENGTH) {
    throw FamilyError.validation({
      field: 'nickname',
      reason: 'too_long',
      max: NICKNAME_MAX_LENGTH,
    });
  }
  return nickname;
}

function toFamilyResult(entry: MembershipWithFamily): FamilyResult {
  return {
    family: toFamilySummary(entry),
    membership: {
      id: entry.membership.id,
      role: asRole(entry.membership.role),
      joinedAt: entry.membership.joinedAt.toISOString(),
    },
  };
}

export function createFamilyService(options: CreateFamilyServiceOptions = {}): FamilyService {
  const repository = options.repository ?? createInMemoryFamilyRepository();
  const clock: Clock = options.clock ?? (() => new Date());
  const random: RandomSource = options.random ?? createCryptoRandom();
  const ttlDays = resolveInviteTtlDays(options.env);

  async function createFamily(
    userId: string,
    input: CreateFamilyRequest,
  ): Promise<FamilyResult> {
    const name = normalizeFamilyName(input.name);
    const timezone = normalizeTimezone(input.timezone);

    // PROJECT_GUIDE 4.1 A5/A6: the creator becomes the owner; `createFamily` writes that
    // membership itself so a family can never exist without an owner.
    const now = clock();
    const inviteCode = await generateUniqueInviteCode(
      (code) => repository.isInviteCodeTaken(code),
      random,
    );

    const created = await repository.createFamily({
      name,
      timezone,
      ownerId: userId,
      inviteCode,
      inviteExpireAt: resolveInviteExpiry(now, ttlDays),
      createdAt: now,
    });
    return toFamilyResult(created);
  }

  async function joinFamily(userId: string, input: JoinFamilyRequest): Promise<FamilyResult> {
    const code = normalizeInviteCode(input.inviteCode);
    // A malformed code cannot exist, so it gets the same answer as an unknown one: telling the two
    // apart would only help someone guessing.
    if (!isWellFormedInviteCode(code)) throw FamilyError.invalidInviteCode();

    const family: FamilyRecord | null = await repository.findFamilyByInviteCode(code);
    if (family === null) throw FamilyError.invalidInviteCode();
    if (isInviteExpired(family.inviteExpireAt, clock())) throw FamilyError.inviteExpired();

    // Idempotent on purpose: "家人重复点加入" is the normal case (the button is the only feedback
    // the UI gives), and a 409 here would show a scary error for something that already worked.
    const existing: MembershipRecord | null = await repository.findMembership(userId, family.id);
    if (existing !== null) {
      return toFamilyResult({ family, membership: existing });
    }

    if (input.nickname !== undefined) {
      const nickname = normalizeNickname(input.nickname);
      const user = await repository.findUser(userId);
      if (user === null) throw FamilyError.userNotFound();
      // `nickname` lives on `User`, not on `Membership`, and `prisma/schema.prisma` is frozen for
      // day 1 -- so honouring this field renames the account everywhere, not just in this family.
      // That is surprising enough to be listed as a decision item in this round's report.
      if (user.nickname !== nickname) await repository.updateUserNickname(userId, nickname);
    }

    const member = await repository.addMember({
      familyId: family.id,
      userId,
      // Anyone who is not the creator joins as a plain member. `admin` is granted by the owner
      // through the member-management screen (A6), and `child` belongs to the A8 PIN flow.
      role: 'member',
      joinedAt: clock(),
    });
    return toFamilyResult(member);
  }

  async function listFamilies(userId: string): Promise<FamilySummary[]> {
    const entries = await repository.listMemberships(userId);
    return entries.map(toFamilySummary);
  }

  async function listMembers(userId: string, familyId: string): Promise<MemberSummary[]> {
    // CONTRACTS section 2: every `/api/families/:fid/**` call must prove membership first.
    const membership = await repository.findMembership(userId, familyId);
    if (membership === null) throw FamilyError.notAMember();

    const rows = await repository.listMembers(familyId);
    return rows.map(toMemberSummary);
  }

  return { createFamily, joinFamily, listFamilies, listMembers };
}
