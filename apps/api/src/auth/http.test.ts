/**
 * End-to-end HTTP tests for lane A: register -> login -> me, through a real Fastify instance.
 *
 * This file is also the written proof of the things day 1 got wrong once and must not get wrong again:
 *   1. **contract conformance** -- the response bodies match `apps/web/src/api/types.ts` exactly,
 *      key for key (the shapes below are copied from that file, which lane C wrote first);
 *   2. another module can mount a protected route with `app.requireAuth` + `currentUserId()`
 *      (lane B / lane C are explicitly told not to write their own middleware);
 *   3. `GET /api/auth/me` picks up lane B's families the moment a `FamilyDirectoryPort` is passed.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { registerAuth } from '../routes/auth.js';
import { currentUserId } from './middleware.js';
import { createInMemoryAuthRepository } from './repository.js';
import type { FamilyDirectoryPort, FamilySummary } from './types.js';

/* ---- mirrors apps/web/src/api/types.ts (frozen by CONTRACTS "前端调用约定") ---- */

interface UserSummaryBody {
  id: string;
  nickname: string;
  avatarUrl?: string;
  phone?: string;
  email?: string;
}

interface FamilySummaryBody {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member' | 'child';
  points: number;
  earnedPoints: number;
  spentPoints: number;
  frozenPoints: number;
}

interface AuthResultBody {
  token: string;
  user: UserSummaryBody;
  families: FamilySummaryBody[];
}

interface MeResultBody {
  user: UserSummaryBody;
  families: FamilySummaryBody[];
}

interface ErrorBody {
  error: string;
  message: string;
  details?: unknown;
}

const SECRET = 'test-secret';

async function buildApp(familyDirectory?: FamilyDirectoryPort): Promise<FastifyInstance> {
  const app = Fastify();
  await registerAuth(app, {
    secret: SECRET,
    ttlSeconds: 3600,
    repository: createInMemoryAuthRepository(),
    ...(familyDirectory === undefined ? {} : { familyDirectory }),
  });

  // Simulates a route owned by lane B / lane C: they reuse lane A's middleware, nothing else.
  app.get('/api/_probe', { preHandler: app.requireAuth }, async (request) => ({
    userId: currentUserId(request),
  }));

  await app.ready();
  return app;
}

const registration = {
  account: '13800138000',
  nickname: '弟弟',
  password: 'a-good-password',
};

describe('auth HTTP surface (CONTRACTS #3-#5)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  it('POST /api/auth/register returns 201 with exactly {token, user, families}', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: registration,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as AuthResultBody;
    expect(Object.keys(body).sort()).toEqual(['families', 'token', 'user']);
    expect(body.user).toEqual({
      id: expect.any(String),
      nickname: '弟弟',
      phone: '13800138000',
    });
    expect(body.families).toEqual([]);
    expect(response.body).not.toContain('scrypt$');
    expect(response.body).not.toContain('a-good-password');
  });

  it('GET /api/auth/me accepts the token issued at registration and returns {user, families}', async () => {
    const registered = (
      await app.inject({ method: 'POST', url: '/api/auth/register', payload: registration })
    ).json() as AuthResultBody;

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${registered.token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as MeResultBody;
    expect(Object.keys(body).sort()).toEqual(['families', 'user']);
    expect(body.user.id).toBe(registered.user.id);
    // lane B has not landed yet: an empty list, not a 500 (contract rule 5)
    expect(body.families).toEqual([]);
  });

  it('keeps the old /api/me path out of service (the frozen path is /api/auth/me)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/me' });
    expect(response.statusCode).toBe(404);
  });

  it('answers 401 as JSON without a token and with a broken token', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(missing.statusCode).toBe(401);
    expect(missing.headers['content-type']).toContain('application/json');
    // No token at all -> "请先登录", never "登录已过期" (Issue #5). The caller never had a session.
    expect(missing.json()).toEqual({ error: 'unauthorized', message: '请先登录' });

    for (const header of ['Bearer nonsense', 'Bearer a.b.c', 'Basic abc']) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: header },
      });
      expect(response.statusCode).toBe(401);
      expect((response.json() as ErrorBody).error).toBe('unauthorized');
    }
  });

  it('POST /api/auth/login returns a token for the same account', async () => {
    const registered = (
      await app.inject({ method: 'POST', url: '/api/auth/register', payload: registration })
    ).json() as AuthResultBody;

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { account: '13800138000', password: registration.password },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as AuthResultBody;
    expect(Object.keys(body).sort()).toEqual(['families', 'token', 'user']);
    expect(body.user.id).toBe(registered.user.id);

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(me.statusCode).toBe(200);
  });

  it('accepts an email account on the same single field', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { account: 'Dad@Example.COM', nickname: '爸爸', password: 'a-good-password' },
    });
    expect(response.statusCode).toBe(201);
    const user = (response.json() as AuthResultBody).user;
    expect(user.email).toBe('dad@example.com');
    expect(user).not.toHaveProperty('phone');
  });

  it('POST /api/auth/login answers 401 with a machine code AND a Chinese message', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: registration });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { account: '13800138000', password: 'definitely-wrong' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: 'invalid_credentials',
      message: '账号或密码不正确',
    });
  });

  it('POST /api/auth/register answers 409 on a duplicate account', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: registration });
    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { ...registration, nickname: '冒名' },
    });

    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'user_exists', message: '该手机号或邮箱已注册' });
  });

  it('answers 400 with zod issues when the body has the wrong shape', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { account: 13800138000, nickname: '弟弟', password: 'a-good-password' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as ErrorBody;
    expect(body.error).toBe('validation_error');
    expect(typeof body.message).toBe('string');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('answers 400 when the body fails a use-case rule', async () => {
    const shortPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { account: '13800138000', nickname: '弟弟', password: 'short' },
    });
    expect(shortPassword.statusCode).toBe(400);
    expect((shortPassword.json() as ErrorBody).error).toBe('validation_error');

    const badAccount = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { account: 'not-an-account', nickname: '弟弟', password: 'a-good-password' },
    });
    expect(badAccount.statusCode).toBe(400);
  });

  it('ignores unknown fields instead of failing, so the client can send extras', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { ...registration, client: 'web', avatarUrl: 'https://example.com/a.png' },
    });
    expect(response.statusCode).toBe(201);
  });

  it('exposes app.auth for other modules and app.requireAuth for their protected routes', async () => {
    expect(app.auth).toBeDefined();
    expect(typeof app.requireAuth).toBe('function');

    const registered = (
      await app.inject({ method: 'POST', url: '/api/auth/register', payload: registration })
    ).json() as AuthResultBody;

    const anonymous = await app.inject({ method: 'GET', url: '/api/_probe' });
    expect(anonymous.statusCode).toBe(401);

    const authenticated = await app.inject({
      method: 'GET',
      url: '/api/_probe',
      headers: { authorization: `Bearer ${registered.token}` },
    });
    expect(authenticated.statusCode).toBe(200);
    expect((authenticated.json() as { userId: string }).userId).toBe(registered.user.id);
  });
});

describe('lane B hand-over seam (FamilyDirectoryPort)', () => {
  const families: FamilySummary[] = [
    {
      id: 'fam_1',
      name: '我们的家',
      role: 'owner',
      points: 42.4,
      earnedPoints: 86.4,
      spentPoints: 44,
      frozenPoints: 5,
    },
  ];

  function directory(): FamilyDirectoryPort {
    return { listFamilies: async (userId) => (userId.length > 0 ? families : []) };
  }

  it('populates families on register, login and me once lane B is wired', async () => {
    const app = await buildApp(directory());
    const registered = (
      await app.inject({ method: 'POST', url: '/api/auth/register', payload: registration })
    ).json() as AuthResultBody;
    expect(registered.families).toEqual(families);

    const loggedIn = (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { account: '13800138000', password: registration.password },
      })
    ).json() as AuthResultBody;
    expect(loggedIn.families).toEqual(families);

    const me = (
      await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${registered.token}` },
      })
    ).json() as MeResultBody;
    expect(me.families).toEqual(families);
  });

  it('forwards the four numbers untouched, so the F6 (v1.3) identity still holds downstream', async () => {
    const app = await buildApp(directory());
    const registered = (
      await app.inject({ method: 'POST', url: '/api/auth/register', payload: registration })
    ).json() as AuthResultBody;

    const row = registered.families[0] as FamilySummaryBody;
    expect(Object.keys(row).sort()).toEqual([
      'earnedPoints',
      'frozenPoints',
      'id',
      'name',
      'points',
      'role',
      'spentPoints',
    ]);
    // PROJECT_GUIDE F6 v1.3: available === earned - spent; frozen is a reserved subset of available
    expect(row.earnedPoints - row.spentPoints).toBeCloseTo(row.points, 10);
    expect(row.frozenPoints).toBeLessThanOrEqual(row.points);
    // the auth layer must not round, clamp or recompute anything
    expect(row.points).toBe(42.4);
    expect(row.frozenPoints).toBe(5);
  });

  it('still works when lane B is absent (empty array, never an error)', async () => {
    const app = await buildApp();
    const registered = (
      await app.inject({ method: 'POST', url: '/api/auth/register', payload: registration })
    ).json() as AuthResultBody;
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${registered.token}` },
    });
    expect((response.json() as MeResultBody).families).toEqual([]);
  });
});
