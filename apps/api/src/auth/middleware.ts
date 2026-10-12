/**
 * Request authentication for every protected route in the project.
 *
 * Lane B and lane C do NOT write their own middleware (DAY1-PLAN section 3, lane B: "不要自己再写
 * 一份中间件"). They use the one registered on the root instance by `registerAuth()`:
 *
 *   app.get('/api/families/:fid/members', { preHandler: app.requireAuth }, async (request) => {
 *     const me = currentUserId(request);   // verified user id
 *     ...
 *   });
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, toErrorBody } from './errors.js';
import type { TokenPayload } from './types.js';

const BEARER_PATTERN = /^Bearer[ \t]+(.+)$/i;

/** `Authorization: Bearer <jwt>` per CONTRACTS section 2 "conventions". */
export function readBearerToken(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined) return null;
  const match = BEARER_PATTERN.exec(raw.trim());
  if (match === null) return null;
  const token = match[1];
  if (token === undefined) return null;
  const trimmed = token.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * What `requireAuth` needs -- deliberately named `verifyToken` so `AuthService` satisfies it
 * directly (the codec's lower-level method stays `verify`, the JWS convention).
 */
export interface TokenVerifier {
  verifyToken(token: string): TokenPayload;
}

export type RequireAuth = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * Builds the preHandler. It answers 401 itself and never throws, so a route handler behind it can
 * assume `currentUserId(request)` will succeed.
 *
 * The 401 body goes through `toErrorBody` like every other failure: one contract, one body shape
 * (`{error, message}`). Hand-rolling `{error: 'unauthorized'}` here would make an expired token look
 * different from every other auth failure.
 */
export function createRequireAuth(verifier: TokenVerifier): RequireAuth {
  return async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = readBearerToken(request.headers.authorization);
    if (token === null) {
      const { status, body } = toErrorBody(AuthError.unauthorized('missing_bearer_token'));
      await reply.status(status).send(body);
      return;
    }

    try {
      request.authUser = verifier.verifyToken(token);
    } catch (error) {
      const reason =
        error instanceof AuthError ? (error.logReason ?? error.code) : 'token_verification_failed';
      request.log?.warn({ auth: { reason } }, 'rejected bearer token');
      const { status, body } = toErrorBody(AuthError.unauthorized(reason));
      await reply.status(status).send(body);
    }
  };
}

/** The verified user id. Throws if it is called on a route that is not behind `requireAuth`. */
export function currentUserId(request: FastifyRequest): string {
  const subject = request.authUser?.sub;
  if (subject === undefined || subject.length === 0) {
    throw AuthError.unauthorized('auth_context_missing');
  }
  return subject;
}

/** The whole verified payload, for handlers that need `exp` (e.g. a "session expires soon" hint). */
export function currentTokenPayload(request: FastifyRequest): TokenPayload {
  const payload = request.authUser;
  if (payload === undefined) {
    throw AuthError.unauthorized('auth_context_missing');
  }
  return payload;
}
