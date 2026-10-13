/**
 * CONTRACTS #10b -- `GET /api/families/:fid/invite`: let an owner/admin read the code to share.
 *
 * Why this file exists separately
 * -------------------------------
 * `service.ts` covers the four endpoints lane B delivered (#6-#9). This is the one endpoint that was
 * left unclaimed, and it is the *only* way to obtain an invite code: the `family` object in every
 * other response is the frozen `FamilySummary`, which deliberately carries no `inviteCode`. Without
 * it an owner cannot invite anybody, so the whole "join a family" path is unreachable.
 *
 * It lives beside the module rather than inside it so lane B's delivered logic stays untouched; it
 * reads the same repository and the same invite helpers, and adds no new source of truth.
 *
 * Authorization (frozen in CONTRACTS #10b): owner or admin only.
 * A plain member gets `role_not_allowed` (403) rather than `not_a_member`, because they *are* in the
 * family -- telling them otherwise would be false and alarming.
 */
import { FamilyError } from './errors.js';
import type { FamilyRecord, FamilyRepository, Role } from './types.js';

/** Frozen response shape (CONTRACTS #10b). */
export interface FamilyInviteView {
  inviteCode: string;
  /** ISO-8601, or `null` when the family was created without an expiry. */
  inviteExpireAt: string | null;
  /**
   * What the client turns into a QR code. A URL rather than the bare code so a phone scanner can
   * act on it directly; `code` is included for clients that only need the code.
   */
  qrPayload: string;
}

export interface FamilyInviteService {
  /**
   * CONTRACTS #10b. Throws `not_a_member` when `userId` is not in `familyId`, and
   * `role_not_allowed` when they are in it without an owner/admin role.
   */
  getInvite(userId: string, familyId: string): Promise<FamilyInviteView>;
}

export interface CreateFamilyInviteServiceOptions {
  repository: FamilyRepository;
  /** Base for `qrPayload`; defaults to the web app's join route. */
  joinUrlBase?: string;
}

const DEFAULT_JOIN_URL_BASE = 'https://family-points.app/join';

const SHARING_ROLES: ReadonlySet<string> = new Set<Role>(['owner', 'admin']);

function toInviteView(family: FamilyRecord, joinUrlBase: string): FamilyInviteView {
  return {
    inviteCode: family.inviteCode,
    inviteExpireAt: family.inviteExpireAt === null ? null : family.inviteExpireAt.toISOString(),
    qrPayload: `${joinUrlBase}?code=${encodeURIComponent(family.inviteCode)}`,
  };
}

export function createFamilyInviteService(
  options: CreateFamilyInviteServiceOptions,
): FamilyInviteService {
  const { repository } = options;
  const joinUrlBase = options.joinUrlBase ?? DEFAULT_JOIN_URL_BASE;

  return {
    async getInvite(userId: string, familyId: string): Promise<FamilyInviteView> {
      // `findFamilyById` answers `null` for both "no such family" and "family exists", so the two
      // checks below are ordered to keep the anti-probing promise: unknown family and non-member
      // both end up as `not_a_member` (403), never as a distinguishable 404.
      const family = await repository.findFamilyById(familyId);
      if (family === null) throw FamilyError.notAMember();

      const membership = await repository.findMembership(userId, familyId);
      if (membership === null) throw FamilyError.notAMember();
      if (!SHARING_ROLES.has(membership.role)) throw FamilyError.roleNotAllowed();

      // An expired code is still returned, together with its (past) expiry, so the client can say
      // "this one expired, ask for a new one" instead of showing an error it cannot explain.
      // Regenerating a code is A7's job and is not implemented yet.
      return toInviteView(family, joinUrlBase);
    },
  };
}
