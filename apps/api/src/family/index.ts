/**
 * Public surface of the `family` module (lane B, W1-03..W1-06).
 *
 * Other modules -- and the HTTP layer -- should import from here rather than from the individual
 * files, so the internal layout stays free to change. This mirrors lane A's `auth/index.ts`.
 */
export type {
  AddMemberInput,
  Clock,
  CreateFamilyInput,
  FamilyRecord,
  FamilyRepository,
  FamilyResult,
  FamilySummary,
  MemberRow,
  MemberSummary,
  MembershipRecord,
  MembershipSummary,
  MembershipWithFamily,
  RandomSource,
  Role,
} from './types.js';

export { FamilyError, toErrorBody } from './errors.js';
export type { ErrorBody, FamilyErrorCode } from './errors.js';

export {
  DEFAULT_INVITE_TTL_DAYS,
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH,
  createCryptoRandom,
  encodeInviteCode,
  generateUniqueInviteCode,
  isInviteExpired,
  isWellFormedInviteCode,
  normalizeInviteCode,
  resolveInviteExpiry,
  resolveInviteTtlDays,
} from './invite.js';

export {
  DEFAULT_TIMEZONE,
  FAMILY_NAME_MAX_LENGTH,
  NICKNAME_MAX_LENGTH,
  createFamilyService,
  normalizeFamilyName,
  normalizeTimezone,
  toFamilySummary,
  toMemberSummary,
} from './service.js';
export type {
  CreateFamilyRequest,
  CreateFamilyServiceOptions,
  FamilyService,
  JoinFamilyRequest,
} from './service.js';

export { createInMemoryFamilyRepository } from './repository.js';
export type {
  InMemoryFamilyRepository,
  InMemoryFamilyRepositoryOptions,
  InMemoryUser,
} from './repository.js';

export { createPrismaFamilyRepository } from './repository.prisma.js';
export type {
  PrismaFamilyDelegate,
  PrismaFamilyRow,
  PrismaLikeClient,
  PrismaMembershipDelegate,
  PrismaMembershipRow,
  PrismaUserDelegate,
  PrismaUserRow,
} from './repository.prisma.js';

export { createFamilyDirectory } from './directory.js';
export type { FamilyDirectory } from './directory.js';
