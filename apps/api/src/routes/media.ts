/**
 * CONTRACTS #10 -- `POST /api/families/:fid/instances/:iid/proof` (multipart).
 *
 * The HTTP layer does four things and nothing else: authenticate, prove the caller belongs to
 * `:fid`, take exactly one file part, and hand the bytes to `media/upload.ts`. Every rule about what
 * counts as acceptable evidence lives in the service, so this file can never disagree with the tests.
 *
 * Two details that would otherwise be silent bugs:
 *
 *  - **The transport cap is deliberately larger than the product limit.** `MAX_VIDEO_BYTES` is 20MB;
 *    the multipart reader is capped a little above it so that a 21MB upload is rejected by
 *    *our* validation with a useful Chinese message ("拍短一点") instead of by the parser with a
 *    generic error. A cap equal to the limit would make honest over-limit files produce the wrong
 *    error.
 *  - **Reading the stream to a buffer is intentional.** Writing parts straight into the store would
 *    mean discovering an over-limit file only after gigabytes had been written, and cleaning up
 *    afterwards. The product's limits are small enough that buffering one file is the cheaper risk.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { currentUserId } from '../auth/index.js';
import type { RequireAuth } from '../auth/index.js';
import { MediaError } from '../media/errors.js';
import { MAX_VIDEO_BYTES } from '../media/classify.js';
import type { MediaService } from '../media/upload.js';
import type { FamilyRepository } from '../family/index.js';

/** 21MB: one megabyte of headroom so our own validation reports the failure (see the file header). */
const TRANSPORT_LIMIT_BYTES = MAX_VIDEO_BYTES + 1024 * 1024;

export interface RegisterMediaOptions {
  service: MediaService;
  /** Membership of the caller is what gates upload: you may only attach evidence to your own family. */
  repository: FamilyRepository;
}

function resolveRequireAuth(app: FastifyInstance): RequireAuth {
  const candidate = (app as unknown as { requireAuth?: unknown }).requireAuth;
  if (typeof candidate !== 'function') {
    throw new Error(
      "media routes must be registered AFTER lane A's registerAuth(app): app.requireAuth is not " +
        'decorated on this instance. Mounting media first would leave proof upload public.',
    );
  }
  return candidate as RequireAuth;
}

function fail(reply: FastifyReply, request: FastifyRequest, error: unknown): FastifyReply {
  if (error instanceof MediaError) {
    request.log.warn({ media: error.logReason }, error.message);
    return reply.status(error.status).send({ error: error.code, message: error.message });
  }
  request.log.error({ err: error }, 'media route failed');
  return reply.status(500).send({ error: 'internal_error', message: '服务器开小差了,请稍后再试' });
}

export async function registerMedia(
  app: FastifyInstance,
  options: RegisterMediaOptions,
): Promise<void> {
  // Registered here rather than in server.ts so the dependency sits next to its only consumer, and
  // so `registerRoutes()` remains the single place that decides what the server can do.
  await app.register(multipart, {
    limits: { fileSize: TRANSPORT_LIMIT_BYTES, files: 1, fields: 4 },
  });

  const requireAuth = resolveRequireAuth(app);
  const { service, repository } = options;

  app.post(
    '/api/families/:fid/instances/:iid/proof',
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = request.params as { fid?: unknown; iid?: unknown };
      const familyId = typeof params.fid === 'string' ? params.fid : '';
      const instanceId = typeof params.iid === 'string' ? params.iid : '';
      if (familyId.length === 0 || instanceId.length === 0) {
        return fail(reply, request, MediaError.validation({ field: familyId ? 'iid' : 'fid' }));
      }

      try {
        const callerId = currentUserId(request);
        const membership = await repository.findMembership(callerId, familyId);
        if (membership === null) throw MediaError.notAMember();

        let part;
        try {
          part = await request.file();
        } catch (error) {
          // `@fastify/multipart` throws its own error when the transport cap is hit. Translate it
          // into the product's answer (413) instead of letting it become a 500.
          if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
            throw MediaError.tooLarge('文件太大了,请压缩后重试');
          }
          throw error;
        }
        if (part === undefined) throw MediaError.noFile();

        const bytes = await part.toBuffer();

        const view = await service.uploadProof({
          familyId,
          instanceId,
          uploaderId: callerId,
          bytes,
          declaredContentType: part.mimetype,
        });

        // 201: this creates a resource, and the response body is that resource (CONTRACTS #10).
        return reply.status(201).send({ media: view });
      } catch (error) {
        return fail(reply, request, error);
      }
    },
  );
}
