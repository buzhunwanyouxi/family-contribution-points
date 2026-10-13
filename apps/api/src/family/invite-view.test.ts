/**
 * CONTRACTS #10b -- `GET /api/families/:fid/invite`, tested through the real HTTP surface.
 *
 * The cases that matter are the authorization ones. This endpoint hands out the secret that lets
 * somebody into a family, so the interesting question is not "does it return a code" but "who is
 * allowed to ask". The last case is the anti-probing rule: an unknown family id must be
 * indistinguishable from a family you are not in.
 */
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppServices } from '../composition.js';
import { registerRoutes } from '../routes/index.js';

const SECRET = 'invite-view-test-secret';

describe('GET /api/families/:fid/invite (CONTRACTS #10b)', () => {
  let app: ReturnType<typeof Fastify>;
  let ownerToken: string;
  let memberToken: string;
  let strangerToken: string;
  let familyId: string;

  async function register(account: string, nickname: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { account, password: 'a-good-password', nickname },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().token as string;
  }

  beforeAll(async () => {
    app = Fastify();
    await registerRoutes(app, { services: createAppServices({ secret: SECRET }) });
    await app.ready();

    ownerToken = await register('13910000001', '爸爸');
    memberToken = await register('13910000002', '妈妈');
    strangerToken = await register('13910000003', '邻居');

    const created = await app.inject({
      method: 'POST',
      url: '/api/families',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: '邀请码测试家' },
    });
    expect(created.statusCode, created.body).toBe(201);
    familyId = created.json().family.id as string;

    // The joiner needs the code, which is the whole point of this endpoint -- so this test reaches
    // the service the same way the app would once the code is readable. Chicken-and-egg until #10b
    // exists; from then on the flow is: owner reads it here, joiner posts it.
    const invite = await app.inject({
      method: 'GET',
      url: `/api/families/${familyId}/invite`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(invite.statusCode, invite.body).toBe(200);

    const joined = await app.inject({
      method: 'POST',
      url: '/api/families/join',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { inviteCode: invite.json().inviteCode },
    });
    expect(joined.statusCode, joined.body).toBe(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('the owner gets the code, its expiry and a QR payload', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/families/${familyId}/invite`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();

    expect(Object.keys(body).sort()).toEqual(['inviteCode', 'inviteExpireAt', 'qrPayload']);
    expect(body.inviteCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    expect(body.qrPayload).toContain(encodeURIComponent(body.inviteCode));

    // Default TTL is 7 days (CONTRACTS「邀请码规范」); allow an hour of slack for a slow test run.
    const days = (new Date(body.inviteExpireAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('the code it returns is the one that actually works', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/families/${familyId}/invite`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const code = res.json().inviteCode as string;

    // a fourth account joins using exactly this code
    const token = await register('13910000004', '奶奶');
    const joined = await app.inject({
      method: 'POST',
      url: '/api/families/join',
      headers: { authorization: `Bearer ${token}` },
      payload: { inviteCode: code },
    });
    expect(joined.statusCode, joined.body).toBe(200);
    expect(joined.json().family.id).toBe(familyId);
  });

  it('a plain member may NOT read the code (403 role_not_allowed)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/families/${familyId}/invite`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode, res.body).toBe(403);
    const body = res.json();
    expect(body.error).toBe('role_not_allowed');
    // The message must not claim they are not a member -- they are one.
    expect(body.message).toContain('创建者');
  });

  it('someone outside the family gets not_a_member (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/families/${familyId}/invite`,
      headers: { authorization: `Bearer ${strangerToken}` },
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json().error).toBe('not_a_member');
  });

  it('an unknown family id answers exactly like a family you are not in (anti-probing)', async () => {
    const unknown = await app.inject({
      method: 'GET',
      url: '/api/families/00000000-0000-4000-8000-000000000000/invite',
      headers: { authorization: `Bearer ${strangerToken}` },
    });
    const real = await app.inject({
      method: 'GET',
      url: `/api/families/${familyId}/invite`,
      headers: { authorization: `Bearer ${strangerToken}` },
    });

    expect(unknown.statusCode).toBe(real.statusCode);
    expect(unknown.json().error).toBe(real.json().error);
  });

  it('requires a token at all (401, as JSON)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/families/${familyId}/invite` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorized');
  });
});
