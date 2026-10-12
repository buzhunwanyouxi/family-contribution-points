/**
 * Composition root for the auth module: the ONE place where storage, token codec, clock and the
 * optional family directory are chosen.
 *
 * Everything downstream (routes, middleware, other modules reading `app.auth`) depends on the
 * `AuthService` interface only, so swapping any of these is a change to this file and nothing else.
 */
import { createInMemoryAuthRepository } from './repository.js';
import { buildJwtConfig, createHs256Codec, resolveJwtSecret } from './jwt.js';
import { loginUser } from './login.js';
import { getMe } from './me.js';
import { registerUser } from './register.js';
import { NOOP_AUTH_LOGGER } from './types.js';
import type { AuthLogger, AuthService, AuthUseCaseDeps, FamilyDirectoryPort, AuthRepository, TokenCodec } from './types.js';

export interface CreateAuthServiceOptions {
  /** Defaults to the in-memory repository so a fresh clone runs with zero database setup. */
  repository?: AuthRepository;
  /** Defaults to the dependency-free HS256 codec. */
  tokens?: TokenCodec;
  /** Defaults to `JWT_SECRET`; production refuses to start without a real one. */
  secret?: string;
  ttlSeconds?: number;
  issuer?: string;
  clockToleranceSeconds?: number;
  /** injectable clock in seconds since epoch (token expiry) */
  nowSeconds?: () => number;
  /** implemented by the `family` module (lane B); omit and `/api/me` returns no memberships */
  familyDirectory?: FamilyDirectoryPort;
  logger?: AuthLogger;
  /** environment bag used to resolve JWT_SECRET / JWT_TTL_SECONDS; defaults to process.env */
  env?: Record<string, string | undefined>;
}

export function createAuthService(options: CreateAuthServiceOptions = {}): AuthService {
  const secret =
    options.secret ??
    (options.env === undefined ? resolveJwtSecret().secret : resolveJwtSecret(options.env).secret);

  const tokens =
    options.tokens ??
    createHs256Codec(
      buildJwtConfig({
        secret,
        ...(options.ttlSeconds === undefined ? {} : { ttlSeconds: options.ttlSeconds }),
        ...(options.issuer === undefined ? {} : { issuer: options.issuer }),
        ...(options.clockToleranceSeconds === undefined
          ? {}
          : { clockToleranceSeconds: options.clockToleranceSeconds }),
        ...(options.nowSeconds === undefined ? {} : { nowSeconds: options.nowSeconds }),
      }),
    );

  const deps: AuthUseCaseDeps = {
    repository: options.repository ?? createInMemoryAuthRepository(),
    tokens,
    logger: options.logger ?? NOOP_AUTH_LOGGER,
  };
  if (options.familyDirectory !== undefined) {
    deps.familyDirectory = options.familyDirectory;
  }

  return {
    register: (input) => registerUser(deps, input),
    login: (input) => loginUser(deps, input),
    me: (userId) => getMe(deps, userId),
    verifyToken: (token) => tokens.verifyToken(token),
  };
}
