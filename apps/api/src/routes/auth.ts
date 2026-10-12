/**
 * HTTP layer for the auth module -- CONTRACTS #3 / #4 / #5, lane A (W1-01).
 *
 *   POST /api/auth/register   201 {token, user, families}
 *   POST /api/auth/login      200 {token, user, families}
 *   GET  /api/auth/me         200 {user, families}
 *
 * Paths, bodies and response shapes are frozen by lane C and already coded into
 * `apps/web/src/api/client.ts`; nothing here may drift from `docs/CONTRACTS.md`.
 *
 * `registerAuth()` is called on the ROOT fastify instance (from routes/index.ts), not through
 * `app.register()`. That is deliberate: Fastify decorators added inside `app.register()` are
 * encapsulated and would be invisible to lane B and lane C, which are told to reuse
 * `app.requireAuth` instead of writing their own middleware (DAY1-PLAN section 3).
 */
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, toErrorBody } from '../auth/errors.js';
import { resolveJwtSecret } from '../auth/jwt.js';
import { createRequireAuth, currentUserId } from '../auth/middleware.js';
import { PASSWORD_MAX_LENGTH } from '../auth/password.js';
import { createAuthService } from '../auth/service.js';
import type {
  AuthRepository,
  AuthService,
  FamilyDirectoryPort,
  TokenCodec,
} from '../auth/types.js';

/**
 * Shape check only -- normalisation and every length rule live in `register.ts`, so the HTTP layer
 * and the use-case can never disagree about what "a valid registration" means. Unknown fields are
 * dropped instead of rejected, so a client sending one extra key is not a 400.
 *
 * `account` is a single field (phone OR email) on purpose: CONTRACTS rule 1 says the backend decides
 * which one it is, so the client must not have to declare it.
 */
export const registerBodySchema = z.object({
  account: z.string().max(254),
  password: z.string().max(PASSWORD_MAX_LENGTH),
  nickname: z.string().max(64),
});

export const loginBodySchema = z.object({
  account: z.string().max(254),
  password: z.string().max(PASSWORD_MAX_LENGTH),
});

export interface AuthRoutesOptions {
  repository?: AuthRepository;
  tokens?: TokenCodec;
  secret?: string;
  ttlSeconds?: number;
  issuer?: string;
  clockToleranceSeconds?: number;
  nowSeconds?: () => number;
  familyDirectory?: FamilyDirectoryPort;
}

export interface AuthRoutePluginOptions extends FastifyPluginOptions {
  service: AuthService;
}

function fail(reply: FastifyReply, request: FastifyRequest, error: unknown): FastifyReply {
  const { status, body } = toErrorBody(error);
  if (status >= 500) {
    request.log?.error({ err: error }, 'auth route failed');
  } else if (error instanceof AuthError) {
    request.log?.debug({ auth: { reason: error.logReason } }, 'auth request rejected');
  }
  return reply.status(status).send(body);
}

/** The encapsulated route plugin. Registered by `registerAuth()` with the service injected. */
export async function authRoutes(
  app: FastifyInstance,
  options: AuthRoutePluginOptions,
): Promise<void> {
  const { service } = options;

  app.post('/api/auth/register', async (request, reply) => {
    const parsed = registerBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return fail(reply, request, AuthError.validation(parsed.error.issues));

    try {
      const result = await service.register(parsed.data);
      return reply.status(201).send(result);
    } catch (error) {
      return fail(reply, request, error);
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return fail(reply, request, AuthError.validation(parsed.error.issues));

    try {
      return reply.send(await service.login(parsed.data));
    } catch (error) {
      return fail(reply, request, error);
    }
  });

  app.get('/api/auth/me', { preHandler: app.requireAuth }, async (request, reply) => {
    try {
      return reply.send(await service.me(currentUserId(request)));
    } catch (error) {
      return fail(reply, request, error);
    }
  });
}

/**
 * Root-level install: decorates `app.auth` / `app.requireAuth` for the whole server and mounts the
 * three routes above. Call it exactly once, from `registerRoutes()`.
 */
export async function registerAuth(
  app: FastifyInstance,
  options: AuthRoutesOptions = {},
): Promise<void> {
  let secret = options.secret;
  if (secret === undefined) {
    const resolved = resolveJwtSecret();
    secret = resolved.secret;
    if (resolved.source === 'dev-fallback') {
      app.log.warn(
        'JWT_SECRET is not set -- using the development fallback secret. ' +
          'Set JWT_SECRET before deploying (see .env.example).',
      );
    }
  }

  const service = createAuthService({
    repository: options.repository,
    tokens: options.tokens,
    secret,
    ttlSeconds: options.ttlSeconds,
    issuer: options.issuer,
    clockToleranceSeconds: options.clockToleranceSeconds,
    nowSeconds: options.nowSeconds,
    familyDirectory: options.familyDirectory,
    logger: {
      warn: (message, meta) => {
        app.log.warn({ auth: meta }, message);
      },
    },
  });

  app.decorate('auth', service);
  app.decorate('requireAuth', createRequireAuth(service));

  await app.register(authRoutes, { service });
}
