/**
 * Public surface of the `auth` module (lane A, W1-01).
 *
 * Other modules should import from here, not from the individual files -- that keeps the internal
 * layout free to change without breaking lane B / lane C.
 */
export type {
  Account,
  AuthLogger,
  AuthRepository,
  AuthResult,
  AuthService,
  AuthUserRecord,
  CreateUserInput,
  FamilyDirectoryPort,
  FamilySummary,
  IssuedToken,
  JwtConfig,
  LoginInput,
  MeResult,
  RegisterInput,
  Role,
  TokenCodec,
  TokenPayload,
  UserSummary,
} from './types.js';

export { NOOP_AUTH_LOGGER } from './types.js';
export { AuthError, toErrorBody } from './errors.js';
export type { AuthErrorCode, ErrorBody } from './errors.js';
export { createAuthService } from './service.js';
export type { CreateAuthServiceOptions } from './service.js';
export { registerUser, normalizeRegistration, passwordProblem } from './register.js';
export type { NormalizedRegistration, ValidationIssue } from './register.js';
export { loginUser } from './login.js';
export { getMe } from './me.js';
export { listFamiliesFor } from './families.js';
export { toUserSummary } from './mapper.js';
export {
  createRequireAuth,
  currentTokenPayload,
  currentUserId,
  readBearerToken,
} from './middleware.js';
export type { RequireAuth, TokenVerifier } from './middleware.js';
export {
  DEFAULT_TOKEN_TTL_SECONDS,
  DEV_JWT_SECRET_FALLBACK,
  buildJwtConfig,
  createHs256Codec,
  resolveJwtSecret,
  resolveTokenTtlSeconds,
} from './jwt.js';
export {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  assertPasswordPolicy,
  hashPassword,
  hashSchemeOf,
  hasHasher,
  isPasswordAcceptable,
  registerHasher,
  scryptHasher,
  verifyPassword,
} from './password.js';
export type { PasswordHasher } from './password.js';
export {
  EMAIL_MAX_LENGTH,
  NICKNAME_MAX_LENGTH,
  PHONE_MAX_DIGITS,
  PHONE_MIN_DIGITS,
  detectAccountKind,
  normalizeAccount,
  normalizeEmail,
  normalizeNickname,
  normalizePhone,
} from './identifiers.js';
export type { AccountKind } from './identifiers.js';
export { createInMemoryAuthRepository } from './repository.js';
export type { InMemoryAuthRepository, InMemoryAuthRepositoryOptions } from './repository.js';
export { createPrismaAuthRepository } from './repository.prisma.js';
export type { PrismaLikeClient, PrismaUserDelegate, PrismaUserRow } from './repository.prisma.js';
