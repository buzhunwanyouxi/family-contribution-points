/**
 * HTTP tests for CONTRACTS #16 / #17.
 *
 * The route exists so the "today" screen has something to read. Two things are worth pinning here that
 * unit tests cannot see: that the routes are actually mounted where the contract says, and that a
 * stranger gets 403 while another family's instance id gets 404 -- the same collapsing this project
 * uses everywhere to stop id probing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createAppServices } from '../composition.js';
import { registerRoutes } from './index.js';

const JWT_SECRET = 'instances-http-test-secret-long-enough';

let app: FastifyInstance;
let services: ReturnType<typeof createAppServices>;

beforeEach(async () => {
  app = Fastify();
  services = createAppServices({ secret: JWT_SECRET });
  await registerRoutes(app, { services });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

async function register(account: string, nickname: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { account, password: 'inst-pass-123', nickname },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as { token: string; user: { id: string } };
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

const deadline = new Date('2026-10-20T13:00:00.000Z');

async function seed(familyId: string, title = '洗碗'): Promise<string> {
  const created = await services.instanceRepository.create({
    familyId,
    date: '2026-10-20',
    title,
    maxPoints: 3,
    deadlineAt: deadline,
  });
  return created.id;
}

describe('GET /api/families/:fid/instances (#16)', () => {
  it('返回当天的任务列表(冻结形状)', async () => {
    const owner = await register('13720000001', '任务爸爸');
    const familyId = await createFamily(owner.token, '任务之家');
    await seed(familyId, '洗碗');

    const response = await app.inject({
      method: 'GET',
      url: `/api/families/${familyId}/instances?date=2026-10-20`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(response.statusCode, response.body).toBe(200);

    const { instances } = response.json() as { instances: Record<string, unknown>[] };
    expect(instances).toHaveLength(1);
    expect(Object.keys(instances[0]!).sort()).toEqual(
      [
        'autoAssigned',
        'claimerId',
        'claimedAt',
        'date',
        'deadlineAt',
        'finalPercent',
        'finalPoints',
        'id',
        'maxPoints',
        'status',
        'templateId',
        'title',
      ].sort(),
    );
    expect(instances[0]).toMatchObject({ title: '洗碗', status: 'open', maxPoints: 3 });
    // 不能把 familyId 漏出去:它是内部字段,不在契约里
    expect(instances[0]).not.toHaveProperty('familyId');
  });

  it('只返回那一���的任务', async () => {
    const owner = await register('13720000002', '日期爸爸');
    const familyId = await createFamily(owner.token, '日期之家');
    await seed(familyId);
    await services.instanceRepository.create({
      familyId,
      date: '2026-10-21',
      title: '明天',
      maxPoints: 1,
      deadlineAt: deadline,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/families/${familyId}/instances?date=2026-10-21`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    const { instances } = response.json() as { instances: { title: string }[] };
    expect(instances.map((i) => i.title)).toEqual(['明天']);
  });

  it('★ 缺少或非法 date -> 400(不能悄悄返回全部)', async () => {
    const owner = await register('13720000003', '参数爸爸');
    const familyId = await createFamily(owner.token, '参数之家');

    for (const url of [
      `/api/families/${familyId}/instances`,
      `/api/families/${familyId}/instances?date=today`,
      `/api/families/${familyId}/instances?date=2026-02-31`,
      `/api/families/${familyId}/instances?date=2026-13-01`,
    ]) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${owner.token}` },
      });
      expect(response.statusCode, url).toBe(400);
    }
  });

  it('★ 不是家庭成员 -> 403,且与"家庭不存在"同码(防探测)', async () => {
    const owner = await register('13720000004', '有主爸爸');
    const familyId = await createFamily(owner.token, '有主的家');
    const stranger = await register('13720000005', '外人');

    const denied = await app.inject({
      method: 'GET',
      url: `/api/families/${familyId}/instances?date=2026-10-20`,
      headers: { authorization: `Bearer ${stranger.token}` },
    });
    const unknown = await app.inject({
      method: 'GET',
      url: '/api/families/no-such-family/instances?date=2026-10-20',
      headers: { authorization: `Bearer ${stranger.token}` },
    });

    expect(denied.statusCode).toBe(403);
    expect(unknown.statusCode).toBe(403);
    expect((unknown.json() as { error: string }).error).toBe(
      (denied.json() as { error: string }).error,
    );
  });

  it('无 token -> 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/families/whatever/instances?date=2026-10-20',
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /api/families/:fid/instances/:iid (#17)', () => {
  it('返回单个实例(Summary + 结算字段 + createdAt)', async () => {
    const owner = await register('13720000006', '详情爸爸');
    const familyId = await createFamily(owner.token, '详情之家');
    const instanceId = await seed(familyId);

    const response = await app.inject({
      method: 'GET',
      url: `/api/families/${familyId}/instances/${instanceId}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(response.statusCode, response.body).toBe(200);

    const { instance } = response.json() as { instance: Record<string, unknown> };
    expect(instance).toMatchObject({ id: instanceId, title: '洗碗', status: 'open' });
    // #17 比 #16 多这三项
    expect(instance).toHaveProperty('settledAt', null);
    expect(instance).toHaveProperty('settledBy', null);
    expect(typeof instance.createdAt).toBe('string');
  });

  it('★ 别的家庭的实例 -> 404(与不存在同一个答案)', async () => {
    const ownerA = await register('13720000007', '甲家爸爸');
    const familyA = await createFamily(ownerA.token, '甲家');
    const instanceId = await seed(familyA);

    const ownerB = await register('13720000008', '乙家爸爸');
    const familyB = await createFamily(ownerB.token, '乙家');

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/families/${familyB}/instances/${instanceId}`,
      headers: { authorization: `Bearer ${ownerB.token}` },
    });
    const missing = await app.inject({
      method: 'GET',
      url: `/api/families/${familyB}/instances/does-not-exist`,
      headers: { authorization: `Bearer ${ownerB.token}` },
    });

    expect(foreign.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect((foreign.json() as { error: string }).error).toBe('instance_not_found');
    expect((missing.json() as { error: string }).error).toBe('instance_not_found');
  });
});

describe('★ 路由在契约要求的位置上', () => {
  it('两个读接口都不是 404 Route not found', async () => {
    // 这条防的是 2026-10-15 踩过的坑:路由注册了,但路径少了 /api 前缀,端到端全 404,
    // 而单元测试全绿。只看 statusCode 不够,要看 error 字段是不是 Fastify 的 not-found。
    const owner = await register('13720000009', '路径爸爸');
    const familyId = await createFamily(owner.token, '路径之家');
    const instanceId = await seed(familyId);

    for (const url of [
      `/api/families/${familyId}/instances?date=2026-10-20`,
      `/api/families/${familyId}/instances/${instanceId}`,
    ]) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${owner.token}` },
      });
      const body = response.json() as { error?: string; message?: string };
      expect(body.message ?? '', `路由没挂上:${url}`).not.toContain('not found');
      expect(response.statusCode, url).toBe(200);
    }
  });
});
