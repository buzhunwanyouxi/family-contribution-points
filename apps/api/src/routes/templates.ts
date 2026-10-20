/**
 * HTTP layer for the `template` module -- M2, CONTRACTS #11 / #18 / #19.
 *
 *   POST  /api/families/:fid/templates      201 {template}
 *   GET   /api/families/:fid/templates      200 {templates: TemplateSummary[]}
 *   PATCH /api/families/:fid/templates/:tid 200 {template}
 *
 * #19 is not in the M2 spec's route table: `MVP-MODULES.md` lists only #11 and #18, while B7
 * ("可暂停与恢复") is explicitly in this module's service list. Pause/resume therefore needs a third
 * route; the shape was registered in `CONTRACTS.md` **before** this file was written, and the gap is
 * called out in this round's ops log (section 5) for a human to confirm.
 *
 * Authentication reuses lane A's middleware, exactly as `family` / `points` do: `app.requireAuth` as
 * the preHandler plus `currentUserId(request)`. This module does not write its own guard -- two
 * guards would be two chances to disagree about what "authenticated" means.
 *
 * Paths carry the `/api` prefix explicitly because this plugin is registered straight onto the ROOT
 * instance (it needs the decorator added there, and Fastify decorators do not escape `register()`'s
 * encapsulation). `points.ts` documents the same trap from personal experience.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { currentUserId } from '../auth/index.js';
import type { RequireAuth } from '../auth/index.js';
import { TemplateError, toErrorBody } from '../template/errors.js';
import { createTemplateService } from '../template/service.js';
import type {
  MembershipReader,
  TemplateRepository,
  TemplateService,
} from '../template/index.js';

/**
 * Shape checks only -- every rule (`maxPoints > 0`, `repeatRule` grammar, `timeOfDay` format, the
 * defaults for B3/B4/B5/B6) lives in `template/service.ts`, so the HTTP layer and the use case can
 * never disagree about what a valid template is. Unknown fields are dropped, matching
 * `family`'s route layer.
 *
 * `maxPoints` is `.number()` (not `.optional()`): "must be present and numeric" is a shape fact, and
 * a missing one has to be a 400 either way. The service re-checks it because B2 is a *product* rule
 * and the service is the last line before storage.
 */
export const createTemplateBodySchema = z.object({
  title: z.string().max(400),
  description: z.string().max(2000).optional(),
  timeOfDay: z.string().max(10),
  repeatRule: z.string().max(200),
  maxPoints: z.number(),
  assignMode: z.enum(['claim', 'rotate']).optional(),
  claimerScope: z.enum(['all', 'children', 'specific']).optional(),
  mustBeClaimed: z.boolean().optional(),
  remindBeforeMin: z.number().optional(),
});

/**
 * `status` accepts `archived` at the shape level and is rejected in the service, so the client gets
 * the precise `invalid_status_transition` code instead of a generic shape error. M2 only ever moves a
 * template between `active` and `paused` (B7).
 */
export const setTemplateStatusBodySchema = z.object({
  status: z.enum(['active', 'paused', 'archived']),
});

export const listTemplatesQuerySchema = z.object({
  status: z.enum(['active', 'paused', 'archived', 'all']).optional(),
});

export interface TemplatesRoutePluginOptions {
  service: TemplateService;
}

/**
 * Same guard as `family` / `points`: if `app.requireAuth` is missing, Fastify would run no hook at
 * all and the whole template surface would be public. Failing loudly at registration is the only
 * safe behaviour.
 */
function resolveRequireAuth(app: FastifyInstance): RequireAuth {
  const candidate = (app as unknown as { requireAuth?: unknown }).requireAuth;
  if (typeof candidate !== 'function') {
    throw new Error(
      "template routes must be registered AFTER lane A's registerAuth(app): app.requireAuth is not " +
        'decorated on this instance. Mounting templates first would leave /api/families/**/templates ' +
        'public. See apps/api/src/routes/index.ts.',
    );
  }
  return candidate as RequireAuth;
}

function fail(reply: FastifyReply, request: FastifyRequest, error: unknown): FastifyReply {
  const { status, body } = toErrorBody(error);
  if (status >= 500) {
    request.log?.error({ err: error }, 'template route failed');
  } else if (error instanceof TemplateError) {
    request.log?.debug({ template: { reason: error.logReason } }, 'template request rejected');
  }
  return reply.status(status).send(body);
}

/** Reads `:fid` (and optionally `:tid`) defensively -- Fastify types params as `unknown` here. */
function readParams(params: unknown): { familyId: string; templateId: string } {
  const raw = (params ?? {}) as { fid?: unknown; tid?: unknown };
  return {
    familyId: typeof raw.fid === 'string' ? raw.fid : '',
    templateId: typeof raw.tid === 'string' ? raw.tid : '',
  };
}

/** The encapsulated route plugin. Registered by `registerTemplates()` with a built service. */
export async function templateRoutes(
  app: FastifyInstance,
  options: TemplatesRoutePluginOptions,
): Promise<void> {
  const { service } = options;
  const requireAuth = resolveRequireAuth(app);

  app.post('/api/families/:fid/templates', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createTemplateBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return fail(reply, request, TemplateError.validation(parsed.error.issues));

    const { familyId } = readParams(request.params);
    if (familyId.length === 0) {
      return fail(reply, request, TemplateError.validation({ path: 'fid', message: 'is required' }));
    }

    try {
      // 201: a template is created once and then lives on (unlike an idempotent join).
      return reply
        .status(201)
        .send(await service.createTemplate(currentUserId(request), familyId, parsed.data));
    } catch (error) {
      return fail(reply, request, error);
    }
  });

  app.get('/api/families/:fid/templates', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = listTemplatesQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return fail(reply, request, TemplateError.validation(parsed.error.issues));

    const { familyId } = readParams(request.params);
    if (familyId.length === 0) {
      return fail(reply, request, TemplateError.validation({ path: 'fid', message: 'is required' }));
    }

    try {
      return reply.send(
        await service.listTemplates(currentUserId(request), familyId, parsed.data.status ?? 'active'),
      );
    } catch (error) {
      return fail(reply, request, error);
    }
  });

  app.patch('/api/families/:fid/templates/:tid', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = setTemplateStatusBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return fail(reply, request, TemplateError.validation(parsed.error.issues));

    const { familyId, templateId } = readParams(request.params);
    if (familyId.length === 0 || templateId.length === 0) {
      return fail(
        reply,
        request,
        TemplateError.validation({
          path: familyId.length === 0 ? 'fid' : 'tid',
          message: 'is required',
        }),
      );
    }

    try {
      return reply.send(
        await service.setTemplateStatus(
          currentUserId(request),
          familyId,
          templateId,
          parsed.data.status,
        ),
      );
    } catch (error) {
      return fail(reply, request, error);
    }
  });
}

export interface RegisterTemplatesOptions {
  /**
   * Required, deliberately: B1 (only the owner writes) is enforced by looking the caller up here. A
   * default would mean the check silently stops happening.
   */
  memberships: MembershipReader;
  /** Defaults to the in-memory repository; a Prisma adapter can be injected later. */
  repository?: TemplateRepository;
  /** An already-built service, for tests that want to reuse one instance. */
  service?: TemplateService;
}

/**
 * Root-level install. Call it from `registerRoutes()` **after** `registerFamily()`, so that
 * `app.requireAuth` exists and `services.familyRepository` can be passed as the membership reader.
 */
export async function registerTemplates(
  app: FastifyInstance,
  options: RegisterTemplatesOptions,
): Promise<void> {
  const service =
    options.service ??
    createTemplateService({
      memberships: options.memberships,
      ...(options.repository === undefined ? {} : { repository: options.repository }),
    });

  await app.register(templateRoutes, { service });
}
