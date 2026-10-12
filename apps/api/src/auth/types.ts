/**
 * Local types for the `auth` module (lane A, W1-01).
 *
 * These are NOT invented here: they mirror the FROZEN contract in `docs/CONTRACTS.md` #3-#5 and the
 * frontend types lane C wrote first in `apps/web/src/api/types.ts` (Account / UserSummary /
 * FamilySummary / AuthResult / MeResult). The client is already coded against those shapes, so the
 * backend has to match them exactly -- see this round's ops log, section 3.
 *
 * DAY1-PLAN section 5 freezes `packages/shared` on day 1, so these stay local for now and get hoisted
 * on day 2 -- one deliberate move instead of three AIs editing the shared file at once.
 *
 * This file also owns the ONLY `fastify` module augmentation in the project. Other modules must not
 * declare their own: two augmentations of the same interface is a guaranteed merge conflict.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

export type Role = 'owner' | 'admin' | 'member' | 'child';

/** One field that accepts either a phone number or an email address (CONTRACTS #3/#4). */
export type Account = string;

/** A user row exactly as the persistence layer returns it. NEVER send this to a client. */
export interface AuthUserRecord {
  id: string;
  phone: string | null;
  email: string | null;
  nickname: string;
  avatarUrl: string | null;
  /** scheme-tagged hash produced by password.ts */
  pwdHash: string;
  createdAt: Date;
}

/**
 * Wire shape frozen by CONTRACTS "前端调用约定" (identical to the frontend's `UserSummary`).
 *
 * The optional fields are **omitted when absent, never `null`** -- `null` is not assignable to
 * `phone?: string`, so emitting it would break the declared contract at the type level.
 */
export interface UserSummary {
  id: string;
  nickname: string;
  avatarUrl?: string;
  phone?: string;
  email?: string;
}

/**
 * Wire shape frozen by CONTRACTS "前端调用约定" (identical to the frontend's `FamilySummary`).
 *
 * The four numbers are the v1.3 F5/F6 semantics and MUST all be present:
 *   points       = 当前可用 = earnedPoints - spentPoints   (the `Membership.points` column)
 *   earnedPoints = 累计获得 (only an E8 reversal lowers it)
 *   spentPoints  = 已消费   (redeem + wish contribution + bounty payout)
 *   frozenPoints = 冻结中   (a reserved SUBSET of `points`, not an extra deduction)
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

export interface CreateUserInput {
  phone: string | null;
  email: string | null;
  nickname: string;
  pwdHash: string;
}

/* ------------------------------------------------------------------------------------------------
 * Persistence port -- THE database seam of this module
 * ---------------------------------------------------------------------------------------------- */

/**
 * Two implementations exist today and both satisfy this interface, so `register.ts` / `login.ts`
 * and the HTTP layer never change when storage changes:
 *   - `createInMemoryAuthRepository()`   (repository.ts)        -- dev / unit tests, zero setup
 *   - `createPrismaAuthRepository(c)`    (repository.prisma.ts) -- real rows via `client.user.*`
 */
export interface AuthRepository {
  findById(id: string): Promise<AuthUserRecord | null>;
  findByPhone(phone: string): Promise<AuthUserRecord | null>;
  findByEmail(email: string): Promise<AuthUserRecord | null>;
  create(input: CreateUserInput): Promise<AuthUserRecord>;
}

/* ------------------------------------------------------------------------------------------------
 * Cross-module seam owned by lane B (`family`, W1-03..W1-06)
 * ---------------------------------------------------------------------------------------------- */

/**
 * CONTRACTS rule 5 requires `families` on register / login / me alike -- **an empty array, never an
 * error**, when the user belongs to nothing. Lane C's mock already behaves that way and the UI
 * depends on it, so this port is the single hand-over point for lane B.
 *
 * Until lane B wires it, auth answers `families: []` (which is also the correct answer for a
 * brand-new account), and lane A stays shippable.
 *
 * ⚠️ The auth module must **never compute points**. Whatever this port returns is forwarded
 * verbatim; the single source of truth for the four numbers is `apps/api/src/points/ledger.ts`
 * (CONTRACTS "前端调用约定", PROJECT_GUIDE F5/F6 v1.3).
 */
export interface FamilyDirectoryPort {
  listFamilies(userId: string): Promise<FamilySummary[]>;
}

/* ------------------------------------------------------------------------------------------------
 * Tokens
 * ---------------------------------------------------------------------------------------------- */

/** Access-token payload (HS256). `typ` is reserved so refresh tokens can be added later. */
export interface TokenPayload {
  /** user id */
  sub: string;
  /** issued at, seconds since epoch */
  iat: number;
  /** expires at, seconds since epoch */
  exp: number;
  typ: 'access';
  iss: string;
}

export interface IssuedToken {
  token: string;
  /** ISO-8601 UTC -- used by tests and by anyone adding a refresh flow; deliberately NOT in the
   *  wire body, because CONTRACTS #3/#4 freeze the response as exactly `{token, user, families}`. */
  expiresAt: string;
  /** seconds */
  expiresIn: number;
}

/**
 * Token codec seam: the default implementation is dependency-free HS256 (jwt.ts).
 * Swapping in `jose`/`jsonwebtoken` later means implementing this interface -- nothing else moves.
 */
export interface TokenCodec {
  issue(subject: string): IssuedToken;
  /** named `verifyToken` so an `AuthService` satisfies `TokenVerifier` without an adapter */
  verifyToken(token: string): TokenPayload;
}

export interface JwtConfig {
  secret: string;
  /** seconds */
  ttlSeconds: number;
  issuer: string;
  /** seconds of leeway when checking `exp` / `iat`, so clock skew cannot log everyone out */
  clockToleranceSeconds: number;
  /** injectable clock (seconds since epoch) so expiry tests are deterministic */
  nowSeconds?: () => number;
}

/* ------------------------------------------------------------------------------------------------
 * Use-case inputs / outputs (all frozen by CONTRACTS #3-#5)
 * ---------------------------------------------------------------------------------------------- */

export interface RegisterInput {
  account: Account;
  password: string;
  nickname: string;
}

export interface LoginInput {
  account: Account;
  password: string;
}

/** CONTRACTS #3 / #4 response. */
export interface AuthResult {
  token: string;
  user: UserSummary;
  families: FamilySummary[];
}

/** CONTRACTS #5 response. */
export interface MeResult {
  user: UserSummary;
  families: FamilySummary[];
}

/** Minimal logging surface; the Fastify layer passes a wrapper around `app.log`. */
export interface AuthLogger {
  warn(message: string, meta?: unknown): void;
}

export const NOOP_AUTH_LOGGER: AuthLogger = { warn: () => {} };

/** Everything the use-cases need. Built once by `createAuthService()`. */
export interface AuthUseCaseDeps {
  repository: AuthRepository;
  tokens: TokenCodec;
  logger: AuthLogger;
  familyDirectory?: FamilyDirectoryPort;
}

/** The object exposed as `app.auth` and to every route. */
export interface AuthService {
  register(input: RegisterInput): Promise<AuthResult>;
  login(input: LoginInput): Promise<AuthResult>;
  me(userId: string): Promise<MeResult>;
  /** verify a raw token; throws AuthError('unauthorized') when it is not usable */
  verifyToken(token: string): TokenPayload;
}

/* ------------------------------------------------------------------------------------------------
 * fastify augmentation -- ⚠️ OWNED EXCLUSIVELY BY THE AUTH MODULE
 *
 *   app.auth          -> AuthService
 *   app.requireAuth   -> preHandler for protected routes
 *                        lane B/C usage: `app.get('/x', { preHandler: app.requireAuth }, handler)`
 *   request.authUser  -> verified payload; read it through `currentUserId(request)`
 *
 * ⛔ DO NOT `declare module 'fastify'` ANYWHERE ELSE IN THIS REPO.
 *    Two augmentations of the same interface either collide at compile time or merge silently into
 *    a type nobody can reason about. If you need a new decorator: register it in
 *    docs/CONTRACTS.md first, then add it HERE.
 *
 * Why the decorators are installed on the ROOT instance (see routes/index.ts): Fastify decorators
 * added inside `app.register()` are encapsulated, so lane B / lane C could not see them.
 * ---------------------------------------------------------------------------------------------- */
declare module 'fastify' {
  interface FastifyInstance {
    auth: AuthService;
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    /** set by `app.requireAuth`; prefer the `currentUserId()` accessor */
    authUser?: TokenPayload;
  }
}
