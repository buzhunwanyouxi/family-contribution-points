/**
 * Cross-module integration: can a user registered through auth actually create a family?
 *
 * Why this file exists: every existing test suite builds its own fixtures inside one module, so all
 * 215 of them passed while `POST /api/families` returned 500 end-to-end (the family repository held
 * its own empty user table and never saw accounts created by auth). This test walks the real HTTP
 * surface of both modules in one process, which is the only way that gap shows up.
 *
 * It is deliberately written against `registerRoutes` + `createAppServices` -- the same wiring
 * production uses -- rather than against the services directly, so breaking the composition breaks
 * this test.
 */
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppServices } from './composition.js';
import type { AppServices } from './composition.js';
import { registerRoutes } from './routes/index.js';

const SECRET = 'integration-test-secret-value';

describe('auth -> family integration', () => {
  let app: ReturnType<typeof Fastify>;
  let ownerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    const services = createAppServices({ secret: SECRET });
    app = Fastify();
    await registerRoutes(app, { services });
    await app.ready();

    const owner = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { account: '13900000001', password: 'owner-password', nickname: '爸爸' },
    });
    expect(owner.statusCode).toBe(201);
    ownerToken = owner.json().token as string;

    const other = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { account: '13900000002', password: 'other-password', nickname: '儿子' },
    });
    otherToken = other.json().token as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('a freshly registered user can create a family (CONTRACTS #6, expects 201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/families',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: '我们家' },
    });
    expect(res.statusCode, `body=${res.body}`).toBe(201);
    const body = res.json();
    // NOTE: `family` is the frozen FamilySummary (id/name/role/points...). It deliberately does not
    // carry `inviteCode`; handing the code to the owner is CONTRACTS #10b, which is still unclaimed.
    expect(body.family.name).toBe('我们家');
    expect(body.family.role).toBe('owner');
    expect(body.membership.role).toBe('owner');
  });

  it('the creator shows up in the member list with role owner (CONTRACTS #9)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/families',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: '第二个家' },
    });
    const fid = created.json().family.id as string;

    const res = await app.inject({
      method: 'GET',
      url: `/api/families/${fid}/members`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode, `body=${res.body}`).toBe(200);
    const members = res.json().members as { nickname: string; role: string }[];
    expect(members).toHaveLength(1);
    // the nickname comes from the auth-owned user record, i.e. the two modules share one user store
    expect(members[0]).toMatchObject({ nickname: '爸爸', role: 'owner' });
  });

  it('login carries the family list back (CONTRACTS #3/#4/#5 + rule 5)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { account: '13900000001', password: 'owner-password' },
    });
    expect(res.statusCode).toBe(200);
    const families = res.json().families as unknown[];
    expect(families.length).toBeGreaterThan(0);
  });

  /**
   * CONTRACTS #10b landed on 2026-10-13, so the code is now obtainable over HTTP -- which is what
   * makes this a genuine end-to-end join test rather than a repository shortcut.
   */
  it('a second user can join with the invite code and then see the family (CONTRACTS #7)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/families',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: '带邀请码的家' },
    });
    expect(created.statusCode, `body=${created.body}`).toBe(201);
    const familyId = created.json().family.id as string;

    const invite = await app.inject({
      method: 'GET',
      url: `/api/families/${familyId}/invite`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(invite.statusCode, `body=${invite.body}`).toBe(200);
    const inviteCode = invite.json().inviteCode as string;
    expect(inviteCode).toBeTruthy();

    const joined = await app.inject({
      method: 'POST',
      url: '/api/families/join',
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { inviteCode },
    });
    expect(joined.statusCode, `body=${joined.body}`).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: '/api/families',
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(list.statusCode).toBe(200);
    const ids = (list.json().families as { id: string }[]).map((f) => f.id);
    expect(ids).toContain(familyId);
  });

  it('the family repository sees users registered AFTER it was constructed', async () => {
    // registration happened in beforeAll, before any family existed; if the user store were only
    // snapshotted at construction time this would fail
    const res = await app.inject({
      method: 'POST',
      url: '/api/families',
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { name: '后注册的人也要能建家' },
    });
    expect(res.statusCode, `body=${res.body}`).toBe(201);
  });
});
