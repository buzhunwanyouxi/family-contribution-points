/**
 * CONTRACTS #15 -- `GET /api/families/:fid/points/:uid`.
 *
 * Authorisation follows the same shape as the rest of `/api/families/:fid/**` (CONTRACTS section 2):
 * the caller must belong to the family, and a family the caller is not in answers exactly like a
 * family that does not exist (403, never a distinguishable 404). Within the family the numbers are
 * *shared* -- the whole point of the product is that a child can see why their sibling has more
 * points -- so any member may read any member's four numbers.
 *
 * The numbers come straight out of `Membership` and are forwarded by `toPointsView`. This file must
 * never compute them; see the header of `points/view.ts`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { currentUserId } from '../auth/index.js';
import type { RequireAuth } from '../auth/index.js';
import { FamilyError } from '../family/index.js';
import type { FamilyRepository } from '../family/index.js';
import { toPointsView } from '../points/view.js';
import type { PointsView } from '../points/view.js';

export interface RegisterPointsOptions {
  repository: FamilyRepository;
}

/**
 * Same guard as the family routes: if `app.requireAuth` is missing, Fastify would simply run no hook
 * and these numbers would be public. Failing loudly at registration is the only safe behaviour.
 */
function resolveRequireAuth(app: FastifyInstance): RequireAuth {
  const candidate = (app as unknown as { requireAuth?: unknown }).requireAuth;
  if (typeof candidate !== 'function') {
    throw new Error(
      "points routes must be registered AFTER lane A's registerAuth(app): app.requireAuth is not " +
        'decorated on this instance. Mounting points first would leave /api/families/**/points/** ' +
        'public. See apps/api/src/routes/index.ts.',
    );
  }
  return candidate as RequireAuth;
}

function fail(reply: FastifyReply, request: FastifyRequest, error: unknown): FastifyReply {
  if (error instanceof FamilyError) {
    request.log.warn({ points: error.logReason }, error.message);
    return reply.status(error.status).send({ error: error.code, message: error.message });
  }
  request.log.error({ err: error }, 'points route failed');
  return reply.status(500).send({ error: 'internal_error', message: '服务器开小差了,请稍后再试' });
}

export async function registerPoints(
  app: FastifyInstance,
  options: RegisterPointsOptions,
): Promise<void> {
  const requireAuth = resolveRequireAuth(app);
  const { repository } = options;

  // Path includes the `/api` prefix explicitly: like lane A's auth routes, this plugin is registered
  // straight onto the ROOT instance (it needs the `requireAuth` decorator added there, and Fastify
  // decorators do not escape `register()`'s encapsulation). The family routes get their `/api` from
  // `register(..., { prefix })` instead -- forgetting that difference is exactly how this route
  // briefly lived at `/families/...` and answered 404 to every caller. `printRoutes()` shows it.
  app.get('/api/families/:fid/points/:uid', { preHandler: requireAuth }, async (request, reply) => {
    const params = request.params as { fid?: unknown; uid?: unknown };
    const familyId = typeof params.fid === 'string' ? params.fid : '';
    const targetUserId = typeof params.uid === 'string' ? params.uid : '';
    if (familyId.length === 0 || targetUserId.length === 0) {
      return fail(reply, request, FamilyError.validation({ field: familyId ? 'uid' : 'fid' }));
    }

    try {
      const callerId = currentUserId(request);
      // Membership of the CALLER is what gates access. Checking only the target's membership would
      // let a stranger read any member's numbers by guessing a user id.
      const caller = await repository.findMembership(callerId, familyId);
      if (caller === null) throw FamilyError.notAMember();

      const target = await repository.findMembership(targetUserId, familyId);
      // Someone who is not in this family has no numbers here. Same 403 as an unknown family, so the
      // response never confirms whether that user exists.
      if (target === null) throw FamilyError.notAMember();

      const view: PointsView = toPointsView(target);
      return reply.send(view);
    } catch (error) {
      return fail(reply, request, error);
    }
  });
}
