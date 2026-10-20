/**
 * CONTRACTS #16 / #17 -- reading task instances.
 *
 * These two are read-only on purpose. Claiming, starting, submitting and settling each get their own
 * contract (#12/#13/#14) and their own round, because they write -- and a read route that also writes
 * is the kind of thing that makes a "refresh the page" call mutate state.
 *
 * Authorisation follows `/api/families/:fid/**` exactly (CONTRACTS section 2):
 * caller must be in the family, unknown family answers like a non-member (403), and an instance from
 * another family answers like a missing one (404).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { currentUserId } from '../auth/index.js';
import type { RequireAuth } from '../auth/index.js';
import { InstanceError } from '../instances/index.js';
import type { InstanceService, TaskInstanceRecord } from '../instances/index.js';
import type { FamilyRepository } from '../family/index.js';

export interface RegisterInstancesOptions {
  service: InstanceService;
  /** Membership of the caller is what gates access -- same repository the family routes use. */
  repository: FamilyRepository;
}

/** Same guard as the family, points and media routes: no hook means the routes would be public. */
function resolveRequireAuth(app: FastifyInstance): RequireAuth {
  const candidate = (app as unknown as { requireAuth?: unknown }).requireAuth;
  if (typeof candidate !== 'function') {
    throw new Error(
      "instance routes must be registered AFTER lane A's registerAuth(app): app.requireAuth is not " +
        'decorated on this instance. Mounting them first would leave /api/families/**/instances public.',
    );
  }
  return candidate as RequireAuth;
}

function fail(reply: FastifyReply, request: FastifyRequest, error: unknown): FastifyReply {
  if (error instanceof InstanceError) {
    request.log.warn({ instance: error.logReason }, error.message);
    return reply.status(error.status).send({ error: error.code, message: error.message });
  }
  request.log.error({ err: error }, 'instance route failed');
  return reply.status(500).send({ error: 'internal_error', message: '服务器开小差了,请稍后再试' });
}

/**
 * The wire shape (CONTRACTS #16/#17). Written out explicitly rather than `reply.send(record)`:
 * spreading the record would leak `familyId` into every response and would silently publish any
 * column added to the table later.
 */
function toSummary(record: TaskInstanceRecord) {
  return {
    id: record.id,
    templateId: record.templateId,
    title: record.title,
    date: record.date,
    maxPoints: record.maxPoints,
    status: record.status,
    deadlineAt: record.deadlineAt.toISOString(),
    claimerId: record.claimerId,
    claimedAt: record.claimedAt === null ? null : record.claimedAt.toISOString(),
    autoAssigned: record.autoAssigned,
    finalPercent: record.finalPercent,
    finalPoints: record.finalPoints,
  };
}

function toDetail(record: TaskInstanceRecord) {
  return {
    ...toSummary(record),
    settledAt: record.settledAt === null ? null : record.settledAt.toISOString(),
    settledBy: record.settledBy,
    createdAt: record.createdAt.toISOString(),
  };
}

/** `YYYY-MM-DD` only. Rejecting anything else here keeps the repository's date handling simple. */
function parseDateParam(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  // Reject 2026-02-31 style values, which `new Date` would silently roll over.
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

export async function registerInstances(
  app: FastifyInstance,
  options: RegisterInstancesOptions,
): Promise<void> {
  const requireAuth = resolveRequireAuth(app);
  const { service, repository } = options;

  /** Every handler starts here: prove the caller is in the family before touching anything. */
  async function requireMembership(request: FastifyRequest, familyId: string): Promise<string> {
    const callerId = currentUserId(request);
    const membership = await repository.findMembership(callerId, familyId);
    if (membership === null) throw InstanceError.notAMember();
    return callerId;
  }

  app.get(
    '/api/families/:fid/instances',
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = request.params as { fid?: unknown };
      const familyId = typeof params.fid === 'string' ? params.fid : '';
      if (familyId === '') return fail(reply, request, InstanceError.validation({ field: 'fid' }));

      const query = request.query as { date?: unknown };
      // `date` is required: "all instances ever" is not a question the today-screen asks, and an
      // unbounded list would be a denial-of-service waiting to happen.
      const date = parseDateParam(query.date);
      if (date === null) {
        return fail(reply, request, InstanceError.validation({ field: 'date', expected: 'YYYY-MM-DD' }));
      }

      try {
        await requireMembership(request, familyId);
        const instances = await service.listForDate(familyId, date);
        return reply.send({ instances: instances.map(toSummary) });
      } catch (error) {
        return fail(reply, request, error);
      }
    },
  );

  app.get(
    '/api/families/:fid/instances/:iid',
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = request.params as { fid?: unknown; iid?: unknown };
      const familyId = typeof params.fid === 'string' ? params.fid : '';
      const instanceId = typeof params.iid === 'string' ? params.iid : '';
      if (familyId === '' || instanceId === '') {
        return fail(reply, request, InstanceError.validation({ field: familyId ? 'iid' : 'fid' }));
      }

      try {
        await requireMembership(request, familyId);
        const instance = await service.get(familyId, instanceId);
        return reply.send({ instance: toDetail(instance) });
      } catch (error) {
        return fail(reply, request, error);
      }
    },
  );
}
