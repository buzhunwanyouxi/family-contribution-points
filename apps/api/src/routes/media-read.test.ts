/**
 * HTTP tests for `GET /media/<key>` -- the half that makes uploaded evidence visible.
 *
 * The one test that matters most is the round trip: upload, take the `url` out of the response, fetch
 * it, and get the same bytes back. That is exactly what the browser does with `<img src>`, and it is
 * exactly what used to 404. A unit test on the service cannot see it, because the bug was never in
 * the service -- it was that nothing served the path.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createAppServices } from '../composition.js';
import { registerRoutes } from './index.js';

const JWT_SECRET = 'media-read-http-test-secret-long-enough';

/** Structurally valid JPEG header; D7 reads magic bytes, not pixels. */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(300).fill(0x22)]);

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
    payload: { account, password: 'media-pass-123', nickname },
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

/** Upload via the real multipart route and hand back the media object it produced. */
async function uploadProof(token: string, familyId: string, instanceId: string) {
  const boundary = '----fcpmediareadboundary';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="proof.jpg"\r\n' +
      'Content-Type: image/jpeg\r\n\r\n',
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const response = await app.inject({
    method: 'POST',
    url: `/api/families/${familyId}/instances/${instanceId}/proof`,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      authorization: `Bearer ${token}`,
    },
    payload: Buffer.concat([head, Buffer.from(JPEG_BYTES), tail]),
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { media: { id: string; url: string; access?: { exp: number; sig: string } } })
    .media;
}

describe('GET /media/<key>', () => {
  it('★ 往返:上传返回的 url 直接取回同一份字节(这正是浏览器做的事)', async () => {
    const owner = await register('13710000001', '读取爸爸');
    const familyId = await createFamily(owner.token, '读取之家');
    services.instanceStore.add({ id: 'inst-r1', familyId, status: 'doing' });

    const media = await uploadProof(owner.token, familyId, 'inst-r1');
    expect(media.url).toContain(`/media/${familyId}/inst-r1/${media.id}`);

    // 关键:不额外补 Authorization —— 完全按前端 <img src> 的方式请求
    const read = await app.inject({ method: 'GET', url: media.url });
    expect(read.statusCode, read.body.slice(0, 120)).toBe(200);
    expect(new Uint8Array(read.rawPayload)).toEqual(JPEG_BYTES);
    expect(read.headers['content-type']).toContain('image/jpeg');
    expect(read.headers['content-disposition']).toContain('inline');
  });

  it('响应禁止缓存(证据随时可能被删,缓存副本会活得比 72 小时久)', async () => {
    const owner = await register('13710000002', '缓存爸爸');
    const familyId = await createFamily(owner.token, '缓存之家');
    services.instanceStore.add({ id: 'inst-r2', familyId, status: 'doing' });

    const media = await uploadProof(owner.token, familyId, 'inst-r2');
    const read = await app.inject({ method: 'GET', url: media.url });
    expect(read.headers['cache-control']).toContain('no-store');
    expect(read.headers['cache-control']).toContain('private');
  });

  it('★ 签名不能跨文件复用:拿 A 的签名读 B 必须失败', async () => {
    const owner = await register('13710000003', '借用爸爸');
    const familyId = await createFamily(owner.token, '借用之家');
    services.instanceStore.add({ id: 'inst-r3', familyId, status: 'doing' });

    const first = await uploadProof(owner.token, familyId, 'inst-r3');
    const second = await uploadProof(owner.token, familyId, 'inst-r3');
    expect(first.id).not.toBe(second.id);

    // 把 A 的签名拼到 B 的路径上
    const forged = `/media/${familyId}/inst-r3/${second.id}?exp=${first.access!.exp}&sig=${first.access!.sig}`;
    const read = await app.inject({ method: 'GET', url: forged });
    expect(read.statusCode).toBe(404);
  });

  it('★ 改 exp 延长有效期会失效(签名覆盖了到期时间)', async () => {
    const owner = await register('13710000004', '延期爸爸');
    const familyId = await createFamily(owner.token, '延期之家');
    services.instanceStore.add({ id: 'inst-r4', familyId, status: 'doing' });

    const media = await uploadProof(owner.token, familyId, 'inst-r4');
    const extended = media.access!.exp + 86_400;
    const read = await app.inject({
      method: 'GET',
      url: `/media/${familyId}/inst-r4/${media.id}?exp=${extended}&sig=${media.access!.sig}`,
    });
    expect(read.statusCode).toBe(404);
  });

  it('没有签名也没有 token -> 401', async () => {
    const owner = await register('13710000005', '无票爸爸');
    const familyId = await createFamily(owner.token, '无票之家');
    services.instanceStore.add({ id: 'inst-r5', familyId, status: 'doing' });

    const media = await uploadProof(owner.token, familyId, 'inst-r5');
    const bare = media.url.split('?')[0]!;
    const read = await app.inject({ method: 'GET', url: bare });
    expect(read.statusCode).toBe(401);
  });

  it('★ 用 token 但属于别人家 -> 403(登录了也不等于能看别人家的证据)', async () => {
    const owner = await register('13710000006', '主人');
    const familyId = await createFamily(owner.token, '有主的家');
    services.instanceStore.add({ id: 'inst-r6', familyId, status: 'doing' });
    const media = await uploadProof(owner.token, familyId, 'inst-r6');

    const stranger = await register('13710000007', '外人');
    const bare = media.url.split('?')[0]!;
    const read = await app.inject({
      method: 'GET',
      url: bare,
      headers: { authorization: `Bearer ${stranger.token}` },
    });
    expect(read.statusCode).toBe(403);
  });

  it('家庭成员用 token 也能读(下载按钮走的就是这条路)', async () => {
    const owner = await register('13710000008', '家里人');
    const familyId = await createFamily(owner.token, '温暖的家');
    services.instanceStore.add({ id: 'inst-r7', familyId, status: 'doing' });
    const media = await uploadProof(owner.token, familyId, 'inst-r7');

    const bare = media.url.split('?')[0]!;
    const read = await app.inject({
      method: 'GET',
      url: bare,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(read.statusCode).toBe(200);
    expect(new Uint8Array(read.rawPayload)).toEqual(JPEG_BYTES);
  });

  it('★ 上传返回的 url 必须"可直接请求",不能要求调用方再拼一次签名', async () => {
    const owner = await register('13710000011', '拼接爸爸');
    const familyId = await createFamily(owner.token, '拼接之家');
    services.instanceStore.add({ id: 'inst-r10', familyId, status: 'doing' });
    const media = await uploadProof(owner.token, familyId, 'inst-r10');

    // 这条断言防的是一个真实踩过的坑:响应里同时给了 url 和 access,如果 url 还需要拼 access,
    // 那么"照着文档拼一次"的客户端会得到 ?exp=..&sig=..?exp=..&sig=.. —— 第二个 exp 变成
    // "值?exp=…",签名校验失败,而 url 看起来完全正常。
    expect(media.url).toContain('sig=');
    const direct = await app.inject({ method: 'GET', url: media.url });
    expect(direct.statusCode, 'url 应当可以直接请求').toBe(200);

    // access 是给"重新拉取列表时自己重建 query"用的,不是让你拼到 url 后面
    expect(media.access?.sig).toBeDefined();
    const doubled = `${media.url}?exp=${media.access!.exp}&sig=${media.access!.sig}`;
    expect(doubled).not.toBe(media.url);
    // 拼第二次的请求必须是失败(或者至少不是那个正常响应),证明文档里那句"不要拼"是对的
    const wrong = await app.inject({ method: 'GET', url: doubled });
    expect(wrong.statusCode).not.toBe(200);
  });

  it('download=1 -> attachment,并按类型给出文件名', async () => {
    const owner = await register('13710000009', '下载爸爸');
    const familyId = await createFamily(owner.token, '下载之家');
    services.instanceStore.add({ id: 'inst-r8', familyId, status: 'doing' });
    const media = await uploadProof(owner.token, familyId, 'inst-r8');

    const read = await app.inject({ method: 'GET', url: `${media.url}&download=1` });
    expect(read.statusCode).toBe(200);
    expect(read.headers['content-disposition']).toContain('attachment');
    expect(read.headers['content-disposition']).toContain('.jpg');
  });

  it('不存在的 media id -> 404(且与"已过期"同一个答案,不能用来探测)', async () => {
    const read = await app.inject({ method: 'GET', url: '/media/some-family/some-instance/nope?exp=99999999999&sig=deadbeef' });
    expect(read.statusCode).toBe(404);
    expect((read.json() as { error: string }).error).toBe('media_gone');
  });

  it('过期后即使签名还有效也读不到(72 小时按读取时刻判定,不依赖删除任务跑没跑)', async () => {
    const owner = await register('13710000010', '到期爸爸');
    const familyId = await createFamily(owner.token, '到期之家');
    services.instanceStore.add({ id: 'inst-r9', familyId, status: 'doing' });
    const media = await uploadProof(owner.token, familyId, 'inst-r9');

    // 把这一条记录的到期时间改到过去,模拟"72 小时到了但删除任务还没跑"
    const record = await services.mediaRepository.findById(media.id);
    expect(record).not.toBeNull();
    await services.mediaRepository.create({
      ...record!,
      expireAt: new Date(Date.now() - 1000),
    });

    const read = await app.inject({ method: 'GET', url: media.url });
    expect(read.statusCode).toBe(404);
    expect((read.json() as { error: string }).error).toBe('media_gone');
  });
});
