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
import { verifyAccess } from '../media/access.js';
import { MediaError } from '../media/errors.js';
import { MAX_VIDEO_BYTES } from '../media/classify.js';
import type { MediaService } from '../media/upload.js';
import type { FamilyRepository } from '../family/index.js';

/** 21MB: one megabyte of headroom so our own validation reports the failure (see the file header). */
const TRANSPORT_LIMIT_BYTES = MAX_VIDEO_BYTES + 1024 * 1024;

/** Mirrors the service default; the two must match or signed URLs will not verify. */
const DEFAULT_ACCESS_SECRET = 'dev-only-media-access-secret-change-me';

export interface RegisterMediaOptions {
  service: MediaService;
  /** Membership of the caller is what gates upload: you may only attach evidence to your own family. */
  repository: FamilyRepository;
  /** Signs and verifies evidence URLs. Defaults to the same development secret the service uses. */
  accessSecret?: string;
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
  const accessSecret = options.accessSecret ?? DEFAULT_ACCESS_SECRET;

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

  // ---------------------------------------------------------------------------------------------
  // GET /media/<key> -- the other half of #10.
  //
  // Without this route the upload's response is a broken image: the url it hands the client 404s.
  // Authorisation comes in one of two shapes, because the same evidence is reached two ways:
  //
  //   * `<img src>` / `<video src>`: **cannot send a header**, so the URL carries `exp` + `sig`.
  //   * the download button: sends the normal Bearer token.
  //
  // Both are checked here rather than in the service, because only the route knows which one the
  // caller used. The signature is verified against the media id parsed out of the path -- a token
  // minted for one photo must not open another.
  // ---------------------------------------------------------------------------------------------
  app.get(
    '/media/*',
    {
      // Two ways in, so the hook has to decide which one applies:
      //   * a signed URL (what `<img src>` uses, since it cannot send a header) -> allowed straight
      //     through, because verifying the signature needs the media id from the route params;
      //   * anything else -> the normal session gate, which also populates `request.authUser`, so the
      //     handler can call `currentUserId()` exactly like every other route.
      // Doing the session check here instead of by hand is not just less code: it produces the same
      // 401 body as everywhere else, and it cannot forget a case.
      preHandler: async (request, reply) => {
        const query = request.query as Record<string, unknown>;
        const signed = typeof query.sig === 'string' && query.sig !== '';
        if (signed) return;
        await requireAuth(request, reply);
      },
    },
    async (request, reply) => {
      const wildcard = (request.params as Record<string, unknown>)['*'];
      const key = typeof wildcard === 'string' ? wildcard : '';
      const mediaId = lastSegment(key);
      if (mediaId === '') return fail(reply, request, MediaError.validation({ field: 'path' }));

      try {
        const query = request.query as Record<string, unknown>;
        const hasSignature = typeof query.sig === 'string' && query.sig !== '';
        const familyId = key.split('/')[0] ?? '';

        if (hasSignature) {
          const verdict = verifyAccess(accessSecret, mediaId, query, new Date());
          if (!verdict.ok) {
            // `expired` is the honest answer for a stale link; a forged signature gets the same 404,
            // so guessing learns nothing about whether the id exists.
            request.log.warn({ media: 'bad_signature', reason: verdict.reason }, '签名校验失败');
            throw MediaError.mediaGone();
          }
        } else {
          // requireAuth ran and answered 401 itself if it was going to; if we are here, there is a
          // verified session. `currentUserId` throwing here would mean the gate was skipped, so let
          // that failure surface rather than being swallowed as a 404.
          const callerId = currentUserId(request);
          const membership =
            familyId === '' ? null : await repository.findMembership(callerId, familyId);
          if (membership === null) throw MediaError.forbidden();
        }

        const proof = await service.readProof(mediaId);
        const wantsDownload = query.download === '1' || query.download === 'true';

        // `private` keeps shared caches out of it; `no-store` because the evidence can be deleted at
        // any moment and a cached copy would outlive the 72-hour rule.
        reply.header('cache-control', 'private, no-store');
        reply.header('content-type', proof.contentType);
        reply.header(
          'content-disposition',
          `${wantsDownload ? 'attachment' : 'inline'}; filename="${proof.filename}"`,
        );
        return reply.send(Buffer.from(proof.bytes));
      } catch (error) {
        return fail(reply, request, error);
      }
    },
  );
}

/**
 * Media id is the last path segment of the storage key; keys are `<familyId>/<instanceId>/<mediaId>`.
 *
 * **No `decodeURIComponent` here.** Fastify already decodes wildcard params (verified: `%2F` arrives as
 * `/`), so decoding again would corrupt any id containing a percent sign and would happily accept a
 * double-encoded path that no legitimate client sends.
 */
function lastSegment(key: string): string {
  const parts = key.split('/').filter((part) => part !== '');
  return parts.length === 0 ? '' : parts[parts.length - 1]!;
}
