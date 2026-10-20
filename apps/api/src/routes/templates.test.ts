/**
 * HTTP-level tests for M2 (CONTRACTS #11 / #18 / #19).
 *
 * The service tests already cover B1/B2/B7. These exist for the things only a real request can catch:
 * a wrong path (the points route once answered 404 end-to-end while every unit test was green), a
 * route mounted outside `app.requireAuth`'s reach, and a status code that drifts from the contract
 * (201 vs 200 vs 403).
 *
 * The app is built in-process, exactly like `media.test.ts`, so registration order in
 * `routes/index.ts` is exercised too -- including the ordering requirement that templates mount after
 * `registerAuth()`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerRoutes } from './index.js';

const JWT_SECRET = 'templates-http-test-secret-with-enough-length';

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify();
  await registerRoutes(app, { secret: JWT_SECRET });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

interface Registered {
  token: string;
  userId: string;
}

async function register(account: string, nickname: string): Promise<Registered> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { account, password: 'template-pass-123', nickname },
  });
  expect(response.statusCode, response.body).toBe(201);
  const body = response.json() as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

async function createFamily(token: string, name: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/families',
    headers: { authorization: `Bearer ${token}` },
    payload: { name },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { family: { id: string } }).family.id;
}

/** Joins as an ordinary member (role `member`), which is what B1 must reject. */
async function addMember(ownerToken: string, familyId: string, account: string): Promise<Registered> {
  const invite = await app.inject({
    method: 'GET',
    url: `/api/families/${familyId}/invite`,
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  expect(invite.statusCode, invite.body).toBe(200);
  const { inviteCode } = invite.json() as { inviteCode: string };

  const member = await register(account, 'member');
  const joined = await app.inject({
    method: 'POST',
    url: '/api/families/join',
    headers: { authorization: `Bearer ${member.token}` },
    payload: { inviteCode },
  });
  expect(joined.statusCode, joined.body).toBe(200);
  return member;
}

interface TemplateBody {
  title: string;
  timeOfDay: string;
  repeatRule: string;
  maxPoints: number;
  [extra: string]: unknown;
}

function templateBody(overrides: Partial<TemplateBody> = {}): TemplateBody {
  return { title: '洗碗', timeOfDay: '14:00', repeatRule: 'daily', maxPoints: 3, ...overrides };
}

describe('POST /api/families/:fid/templates (CONTRACTS #11)', () => {
  it('answers the not-logged-in case with 401 and the new "请先登录" wording (Issue #5)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/families/f-1/templates',
      payload: templateBody(),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized', message: '请先登录' });
  });

  it('creates a template as the owner and answers 201 {template}', async () => {
    const owner = await register('13800000001', '家长');
    const familyId = await createFamily(owner.token, '我们家');

    const response = await app.inject({
      method: 'POST',
      url: `/api/families/${familyId}/templates`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: templateBody({ repeatRule: 'weekly:1,3,5', remindBeforeMin: 15 }),
    });

    expect(response.statusCode, response.body).toBe(201);
    const { template } = response.json() as { template: Record<string, unknown> };
    expect(template).toMatchObject({
      familyId,
      title: '洗碗',
      timeOfDay: '14:00',
      repeatRule: 'weekly:1,3,5',
      maxPoints: 3,
      assignMode: 'claim',
      claimerScope: 'all',
      mustBeClaimed: true,
      remindBeforeMin: 15,
      status: 'active',
    });
    expect(typeof template.createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(template.createdAt as string))).toBe(false);
  });

  it('rejects a joined member with 403 not_owner (B1)', async () => {
    const owner = await register('13800000002', '家长');
    const familyId = await createFamily(owner.token, '我们家');
    const member = await addMember(owner.token, familyId, '13900000002');

    const response = await app.inject({
      method: 'POST',
      url: `/api/families/${familyId}/templates`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: templateBody(),
    });

    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: string }).error).toBe('not_owner');
  });

  it('rejects someone outside the family with 403 not_a_member', async () => {
    const owner = await register('13800000003', '家长');
    const familyId = await createFamily(owner.token, '我们家');
    const stranger = await register('13900000003', '外人');

    const response = await app.inject({
      method: 'POST',
      url: `/api/families/${familyId}/templates`,
      headers: { authorization: `Bearer ${stranger.token}` },
      payload: templateBody(),
    });

    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: string }).error).toBe('not_a_member');
  });

  it('rejects a template without maxPoints (B2) with 400', async () => {
    const owner = await register('13800000004', '家长');
    const familyId = await createFamily(owner.token, '我们家');

    const { maxPoints: _omitted, ...withoutMaxPoints } = templateBody();
    const response = await app.inject({
      method: 'POST',
      url: `/api/families/${familyId}/templates`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: withoutMaxPoints,
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: string }).error).toBe('validation_error');
  });

  it('rejects maxPoints <= 0 (B2) with 400', async () => {
    const owner = await register('13800000005', '家长');
    const familyId = await createFamily(owner.token, '我们家');

    const response = await app.inject({
      method: 'POST',
      url: `/api/families/${familyId}/templates`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: templateBody({ maxPoints: 0 }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a malformed repeatRule with its own code, and accepts weekly:7', async () => {
    const owner = await register('13800000006', '家长');
    const familyId = await createFamily(owner.token, '我们家');
    const headers = { authorization: `Bearer ${owner.token}` };

    const bad = await app.inject({
      method: 'POST',
      url: `/api/families/${familyId}/templates`,
      headers,
      payload: templateBody({ repeatRule: 'weekly:8' }),
    });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: string }).error).toBe('invalid_repeat_rule');

    // 7 is Sunday, the highest legal weekday -- it must be accepted, not treated as out of range.
    const sunday = await app.inject({
      method: 'POST',
      url: `/api/families/${familyId}/templates`,
      headers,
      payload: templateBody({ repeatRule: 'weekly:7' }),
    });
    expect(sunday.statusCode, sunday.body).toBe(201);
  });
});

describe('GET /api/families/:fid/templates (CONTRACTS #18)', () => {
  it('lists active templates for any member', async () => {
    const owner = await register('13800000011', '家长');
    const familyId = await createFamily(owner.token, '我们家');
    const member = await addMember(owner.token, familyId, '13900000011');

    for (const title of ['洗碗', '扫地']) {
      const created = await app.inject({
        method: 'POST',
        url: `/api/families/${familyId}/templates`,
        headers: { authorization: `Bearer ${owner.token}` },
        payload: templateBody({ title }),
      });
      expect(created.statusCode, created.body).toBe(201);
    }

    const response = await app.inject({
      method: 'GET',
      url: `/api/families/${familyId}/templates`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(response.statusCode, response.body).toBe(200);
    const { templates } = response.json() as { templates: { title: string; status: string }[] };
    expect(templates.map((t) => t.title)).toEqual(['洗碗', '扫地']);
    expect(templates.every((t) => t.status === 'active')).toBe(true);
  });

  it('answers 403 for a family the caller is not in', async () => {
    const owner = await register('13800000012', '家长');
    const familyId = await createFamily(owner.token, '我们家');
    const stranger = await register('13900000012', '外人');

    const response = await app.inject({
      method: 'GET',
      url: `/api/families/${familyId}/templates`,
      headers: { authorization: `Bearer ${stranger.token}` },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('PATCH /api/families/:fid/templates/:tid (CONTRACTS #19, B7)', () => {
  async function seedOne(): Promise<{ token: string; familyId: string; templateId: string }> {
    const owner = await register('13800000021', '家长');
    const familyId = await createFamily(owner.token, '我们家');
    const created = await app.inject({
      method: 'POST',
      url: `/api/families/${familyId}/templates`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: templateBody(),
    });
    expect(created.statusCode, created.body).toBe(201);
    return {
      token: owner.token,
      familyId,
      templateId: (created.json() as { template: { id: string } }).template.id,
    };
  }

  it('pauses and resumes, and the active list follows', async () => {
    const { token, familyId, templateId } = await seedOne();
    const headers = { authorization: `Bearer ${token}` };

    const paused = await app.inject({
      method: 'PATCH',
      url: `/api/families/${familyId}/templates/${templateId}`,
      headers,
      payload: { status: 'paused' },
    });
    expect(paused.statusCode, paused.body).toBe(200);
    expect((paused.json() as { template: { status: string } }).template.status).toBe('paused');

    const activeList = await app.inject({
      method: 'GET',
      url: `/api/families/${familyId}/templates`,
      headers,
    });
    expect((activeList.json() as { templates: unknown[] }).templates).toHaveLength(0);

    // History retained: the row is still there when the filter asks for it.
    const allList = await app.inject({
      method: 'GET',
      url: `/api/families/${familyId}/templates?status=all`,
      headers,
    });
    expect((allList.json() as { templates: { id: string }[] }).templates.map((t) => t.id)).toEqual([
      templateId,
    ]);

    const resumed = await app.inject({
      method: 'PATCH',
      url: `/api/families/${familyId}/templates/${templateId}`,
      headers,
      payload: { status: 'active' },
    });
    expect(resumed.statusCode, resumed.body).toBe(200);
    const afterResume = await app.inject({
      method: 'GET',
      url: `/api/families/${familyId}/templates`,
      headers,
    });
    expect((afterResume.json() as { templates: unknown[] }).templates).toHaveLength(1);
  });

  it('rejects archived with 400 invalid_status_transition', async () => {
    const { token, familyId, templateId } = await seedOne();

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/families/${familyId}/templates/${templateId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'archived' },
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: string }).error).toBe('invalid_status_transition');
  });

  it('answers 404 for an unknown template id', async () => {
    const { token, familyId } = await seedOne();

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/families/${familyId}/templates/nope`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'paused' },
    });

    expect(response.statusCode).toBe(404);
    expect((response.json() as { error: string }).error).toBe('template_not_found');
  });

  it('rejects a joined member with 403 not_owner', async () => {
    const { token, familyId, templateId } = await seedOne();
    const member = await addMember(token, familyId, '13900000021');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/families/${familyId}/templates/${templateId}`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { status: 'paused' },
    });

    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: string }).error).toBe('not_owner');
  });
});
