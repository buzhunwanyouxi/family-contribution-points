/**
 * HTTP layer for the `family` module -- CONTRACTS #6 / #7 / #8 / #9, lane B (W1-03..W1-06).
 *
 *   POST /api/families                     201 {family, membership}
 *   POST /api/families/join                200 {family, membership}
 *   GET  /api/families                     200 {families: FamilySummary[]}
 *   GET  /api/families/:fid/members        200 {members: MemberSummary[]}
 *
 * Paths, bodies and response shapes are frozen by lane C and already coded into
 * `apps/web/src/api/client.ts`; nothing here may drift from `docs/CONTRACTS.md`.
 *
 * Authentication reuses lane A's middleware exactly as CONTRACTS「auth 模块交付说明」prescribes:
 * `app.requireAuth` as the preHandler plus `currentUserId(request)` for the verified user id.
 * This module does **not** write its own guard -- DAY1-PLAN section 3 forbids it, and two guards
 * would be two chances to disagree about what "authenticated" means.
 *
 * `registerFamily()` is therefore called **after** `registerAuth()` in `routes/index.ts`, and it
 * throws on startup if `app.requireAuth` is missing. Failing loudly is the point: the alternative
 * (Fastify reading `undefined` as "no hook") would silently publish every family endpoint.
 */
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { currentUserId } from '../auth/index.js';
import type { RequireAuth } from '../auth/index.js';
import { FamilyError, toErrorBody } from '../family/errors.js';
import { createFamilyService } from '../family/service.js';
import type { FamilyRepository, FamilyService } from '../family/index.js';

/**
 * Shape checks only -- normalisation and every length rule live in `service.ts`, so the HTTP layer
 * and the use case can never disagree about what "a valid family name" means. Unknown fields are
 * dropped rather than rejected, matching lane A's route layer (`registerBodySchema`).
 *
 * The `.max()` values are deliberately generous: they only stop an absurd payload from reaching the
 * use case, which is where the real limits (`FAMILY_NAME_MAX_LENGTH` = 20) are enforced.
 */
export const createFamilyBodySchema = z.object({
  name: z.string().max(200),
  timezone: z.string().max(64).optional(),
});

export const joinFamilyBodySchema = z.object({
  inviteCode: z.string().max(64),
  nickname: z.string().max(200).optional(),
});

/**
 * Reads the preHandler lane A decorated onto the root instance (`registerAuth()` in
 * `routes/auth.ts`). Throws rather than returning null: an `undefined` preHandler is not an error
 * to Fastify, it is simply "no hook", which would expose these four endpoints to anyone.
 */
function resolveRequireAuth(app: FastifyInstance): RequireAuth {
  const candidate = (app as unknown as { requireAuth?: unknown }).requireAuth;
  if (typeof candidate !== 'function') {
    throw new Error(
      "family routes must be registered AFTER lane A's registerAuth(app): app.requireAuth is not " +
        'decorated on this instance. Mounting family first would leave /api/families/** public. ' +
        'See apps/api/src/routes/index.ts.',
    );
  }
  return candidate as RequireAuth;
}

function fail(reply: FastifyReply, request: FastifyRequest, error: unknown): FastifyReply {
  const { status, body } = toErrorBody(error);
  if (status >= 500) {
    request.log?.error({ err: error }, 'family route failed');
  } else if (error instanceof FamilyError) {
    request.log?.debug({ family: { reason: error.logReason } }, 'family request rejected');
  }
  return reply.status(status).send(body);
}

export interface FamilyRoutePluginOptions extends FastifyPluginOptions {
  service?: FamilyService;
}

/**
 * The encapsulated route plugin. Registered with `{ prefix: '/api' }` so the paths below read as
 * `/families`, exactly as lane A left room for in `routes/index.ts`.
 */
export async function familyRoutes(
  app: FastifyInstance,
  options: FamilyRoutePluginOptions = {},
): Promise<void> {
  if (options.service === undefined) {
    app.log.warn(
      'family module: no service injected -- falling back to the in-memory repository. ' +
        'Family data will be lost on restart; wire createPrismaFamilyRepository() in the bootstrap.',
    );
  }
  const service = options.service ?? createFamilyService();
  const requireAuth = resolveRequireAuth(app);

  app.post('/families', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createFamilyBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return fail(reply, request, FamilyError.validation(parsed.error.issues));

    try {
      return reply
        .status(201)
        .send(await service.createFamily(currentUserId(request), parsed.data));
    } catch (error) {
      return fail(reply, request, error);
    }
  });

  app.post('/families/join', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = joinFamilyBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return fail(reply, request, FamilyError.validation(parsed.error.issues));

    try {
      // 200 rather than 201: joining is idempotent (see `joinFamily` in service.ts), and a repeat
      // join created nothing new, so a "Created" status would be a lie half the time.
      return reply.send(await service.joinFamily(currentUserId(request), parsed.data));
    } catch (error) {
      return fail(reply, request, error);
    }
  });

  app.get('/families', { preHandler: requireAuth }, async (request, reply) => {
    try {
      return reply.send({ families: await service.listFamilies(currentUserId(request)) });
    } catch (error) {
      return fail(reply, request, error);
    }
  });

  app.get('/families/:fid/members', { preHandler: requireAuth }, async (request, reply) => {
    const params = request.params as { fid?: unknown };
    const familyId = typeof params.fid === 'string' ? params.fid : '';
    if (familyId.length === 0) return fail(reply, request, FamilyError.validation({ field: 'fid' }));

    try {
      return reply.send({ members: await service.listMembers(currentUserId(request), familyId) });
    } catch (error) {
      return fail(reply, request, error);
    }
  });

  // CONTRACTS #10b (added 2026-10-13). Registered after `.../members`, which is unambiguous for
  // Fastify's router, but kept adjacent so the two `:fid` sub-resources read together.
  // Returns the flat `{inviteCode, inviteExpireAt, qrPayload}` shape frozen in the contract.
  app.get('/families/:fid/invite', { preHandler: requireAuth }, async (request, reply) => {
    const params = request.params as { fid?: unknown };
    const familyId = typeof params.fid === 'string' ? params.fid : '';
    if (familyId.length === 0) return fail(reply, request, FamilyError.validation({ field: 'fid' }));

    try {
      return reply.send(await service.getInvite(currentUserId(request), familyId));
    } catch (error) {
      return fail(reply, request, error);
    }
  });
}

export interface RegisterFamilyOptions {
  /** Defaults to the in-memory repository; production injects the Prisma adapter. */
  repository?: FamilyRepository;
  /**
   * An already-built service. `routes/index.ts` passes one because lane A's `familyDirectory`
   * needs the very same instance.
   */
  service?: FamilyService;
}

/**
 * Root-level install: decorates `app.family` so other modules can reuse the service (and so
 * `createFamilyDirectory()` has something to wrap), then mounts the four routes under `/api`.
 *
 * Call it exactly once, from `registerRoutes()`, **after** `registerAuth(app)`.
 */
export async function registerFamily(
  app: FastifyInstance,
  options: RegisterFamilyOptions = {},
): Promise<void> {
  const service = options.service ?? createFamilyService({ repository: options.repository });

  app.decorate('family', service);
  await app.register(familyRoutes, { prefix: '/api', service });
}
