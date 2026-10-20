import { describe, expect, it } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthError } from './errors.js';
import { DEFAULT_ISSUER, createHs256Codec } from './jwt.js';
import {
  createRequireAuth,
  currentTokenPayload,
  currentUserId,
  readBearerToken,
} from './middleware.js';

function makeCodec(ttlSeconds = 3600, nowSeconds?: () => number) {
  return createHs256Codec({
    secret: 'test-secret',
    ttlSeconds,
    issuer: DEFAULT_ISSUER,
    clockToleranceSeconds: 0,
    ...(nowSeconds === undefined ? {} : { nowSeconds }),
  });
}

const codec = makeCodec();
const requireAuth = createRequireAuth(codec);

function fakeRequest(authorization?: string): FastifyRequest {
  return {
    headers: authorization === undefined ? {} : { authorization },
    log: { warn: () => {} },
  } as unknown as FastifyRequest;
}

function fakeReply(): { reply: FastifyReply; state: { status: number; body: unknown } } {
  const state = { status: 200, body: undefined as unknown };
  const reply = {
    status(code: number) {
      state.status = code;
      return reply;
    },
    send(body: unknown) {
      state.body = body;
      return reply;
    },
  };
  return { reply: reply as unknown as FastifyReply, state };
}

describe('readBearerToken', () => {
  it('reads the documented `Bearer <jwt>` form', () => {
    expect(readBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(readBearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(readBearerToken('Bearer    abc.def.ghi  ')).toBe('abc.def.ghi');
  });

  it('rejects everything else', () => {
    expect(readBearerToken(undefined)).toBeNull();
    expect(readBearerToken('')).toBeNull();
    expect(readBearerToken('Bearer')).toBeNull();
    expect(readBearerToken('Bearer   ')).toBeNull();
    expect(readBearerToken('Basic abc')).toBeNull();
    expect(readBearerToken('abc.def.ghi')).toBeNull();
  });

  it('uses the first value when a header arrives more than once', () => {
    expect(readBearerToken(['Bearer first', 'Bearer second'])).toBe('first');
    expect(readBearerToken([])).toBeNull();
  });
});

describe('createRequireAuth', () => {
  it('answers 401 when the header is missing', async () => {
    const request = fakeRequest();
    const { reply, state } = fakeReply();
    await requireAuth(request, reply);
    expect(state.status).toBe(401);
    // same body shape as every other auth failure: machine code + Chinese message.
    // "请先登录", not "登录已过期": a first-time visitor never had a session to expire (Issue #5).
    expect(state.body).toEqual({ error: 'unauthorized', message: '请先登录' });
    expect(request.authUser).toBeUndefined();
  });

  it('keeps "登录已过期" for a token that was sent but is unusable', async () => {
    // The opposite half of Issue #5: splitting the wording must not flatten both cases into one.
    // A token WAS presented here, so "expired / invalid" is the truthful message.
    const request = fakeRequest('Bearer nonsense');
    const { reply, state } = fakeReply();
    await requireAuth(request, reply);
    expect(state.status).toBe(401);
    expect(state.body).toEqual({ error: 'unauthorized', message: '登录已过期,请重新登录' });
  });

  it('answers 401 for a malformed or wrongly-signed token, without throwing', async () => {
    for (const header of ['Bearer nonsense', 'Bearer a.b.c', `Bearer ${codec.issue('u1').token}x`]) {
      const request = fakeRequest(header);
      const { reply, state } = fakeReply();
      await expect(requireAuth(request, reply)).resolves.toBeUndefined();
      expect(state.status).toBe(401);
      expect(request.authUser).toBeUndefined();
    }
  });

  it('answers 401 for an expired token', async () => {
    let now = 1_700_000_000;
    const expiring = makeCodec(60, () => now);
    const expiringAuth = createRequireAuth(expiring);
    const token = expiring.issue('u1').token;
    now += 61;

    const request = fakeRequest(`Bearer ${token}`);
    const { reply, state } = fakeReply();
    await expiringAuth(request, reply);
    expect(state.status).toBe(401);
  });

  it('injects the verified payload and lets currentUserId read it', async () => {
    const request = fakeRequest(`Bearer ${codec.issue('user-42').token}`);
    const { reply, state } = fakeReply();
    await requireAuth(request, reply);

    expect(state.status).toBe(200);
    expect(state.body).toBeUndefined();
    expect(request.authUser?.sub).toBe('user-42');
    expect(currentUserId(request)).toBe('user-42');
    expect(currentTokenPayload(request).typ).toBe('access');
  });
});

describe('currentUserId / currentTokenPayload', () => {
  it('throws an AuthError when called on a route that is not behind requireAuth', () => {
    const request = fakeRequest();
    expect(() => currentUserId(request)).toThrow(AuthError);
    expect(() => currentTokenPayload(request)).toThrow(AuthError);
  });

  it('throws on an empty subject instead of returning a falsy user id', () => {
    const request = { headers: {}, authUser: { sub: '', iat: 0, exp: 0, typ: 'access', iss: DEFAULT_ISSUER } } as unknown as FastifyRequest;
    expect(() => currentUserId(request)).toThrow(AuthError);
  });
});
