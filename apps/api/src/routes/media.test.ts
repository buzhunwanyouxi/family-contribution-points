/**
 * HTTP-level tests for proof upload (CONTRACTS #10).
 *
 * These exist because the service tests cannot catch the two classes of bug this route is prone to:
 * a wrong path (the points route answered 404 end-to-end while every unit test passed) and a
 * multipart wiring mistake (the parser not being visible to the route, or the size cap producing the
 * wrong error). Both only appear when a real request is made.
 *
 * The app is built in-process rather than spawned: unlike the web smoke test, this one needs to seed
 * a task instance, and the in-memory instance store lives inside `createAppServices()`. Same code
 * path a real request takes, minus the process boundary.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createAppServices } from '../composition.js';
import { registerRoutes } from './index.js';

const JWT_SECRET = 'media-http-test-secret-with-enough-length';

/** A tiny but structurally valid JPEG: D7 validation reads the magic bytes, not the image. */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(300).fill(0x11)]);

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

interface Registered {
  token: string;
  userId: string;
}

async function register(account: string, nickname: string): Promise<Registered> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { account, password: 'media-pass-123', nickname },
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

/** Build a multipart body by hand: Fastify's inject takes a raw payload, not a FormData. */
function multipartBody(
  fileBytes: Uint8Array,
  options: { filename?: string; contentType?: string; fieldName?: string } = {},
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----fcpmediatestboundary';
  const filename = options.filename ?? 'proof.jpg';
  const contentType = options.contentType ?? 'image/jpeg';
  const fieldName = options.fieldName ?? 'file';

  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');

  return {
    payload: Buffer.concat([head, Buffer.from(fileBytes), tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

interface UploadOptions {
  token: string;
  familyId: string;
  instanceId: string;
  bytes?: Uint8Array;
  filename?: string;
  contentType?: string;
}

async function upload(options: UploadOptions) {
  const { payload, headers } = multipartBody(options.bytes ?? JPEG_BYTES, {
    ...(options.filename === undefined ? {} : { filename: options.filename }),
    ...(options.contentType === undefined ? {} : { contentType: options.contentType }),
  });
  return app.inject({
    method: 'POST',
    url: `/api/families/${options.familyId}/instances/${options.instanceId}/proof`,
    headers: { ...headers, authorization: `Bearer ${options.token}` },
    payload,
  });
}

describe('POST /api/families/:fid/instances/:iid/proof', () => {
  it('上传成功返回 201 与 media 对象(url / expireAt / sizeBytes 齐全)', async () => {
    const owner = await register('13700000001', '证据爸爸');
    const familyId = await createFamily(owner.token, '证据之家');
    services.instanceStore.add({ id: 'inst-1', familyId, status: 'doing' });

    const response = await upload({ token: owner.token, familyId, instanceId: 'inst-1' });
    expect(response.statusCode, response.body).toBe(201);

    const { media } = response.json() as { media: Record<string, unknown> };
    expect(media).toMatchObject({ refType: 'instance', refId: 'inst-1', type: 'image', uploaderId: owner.userId });
    expect(typeof media.url).toBe('string');
    expect(typeof media.expireAt).toBe('string');
    expect(media.sizeBytes).toBe(JPEG_BYTES.byteLength);

    // 72 小时:响应里的 expireAt 与 createdAt 之差必须正好是 72h
    const createdAt = new Date(media.createdAt as string).getTime();
    const expireAt = new Date(media.expireAt as string).getTime();
    expect(expireAt - createdAt).toBe(72 * 3_600_000);

    // 字节真的存下来了
    expect(services.proofMediaStore.count()).toBe(1);
  });

  it('★ 路由在契约要求的位置上(单测抓不到路径前缀错误)', async () => {
    const owner = await register('13700000002', '路径爸爸');
    const familyId = await createFamily(owner.token, '路径之家');
    services.instanceStore.add({ id: 'inst-2', familyId, status: 'doing' });

    const response = await upload({ token: owner.token, familyId, instanceId: 'inst-2' });
    // 404 意味着路径错了或路由没挂上;这条断言就是为了在那种情况下立刻说话
    expect(response.statusCode, `路由不在契约要求的位置:${response.body}`).not.toBe(404);
  });

  it('无 token -> 401,且不写存储', async () => {
    const owner = await register('13700000003', '无票爸爸');
    const familyId = await createFamily(owner.token, '无票之家');
    services.instanceStore.add({ id: 'inst-3', familyId, status: 'doing' });

    const { payload, headers } = multipartBody(JPEG_BYTES);
    const response = await app.inject({
      method: 'POST',
      url: `/api/families/${familyId}/instances/inst-3/proof`,
      headers,
      payload,
    });

    expect(response.statusCode).toBe(401);
    expect(services.proofMediaStore.count()).toBe(0);
  });

  it('外人上传 -> 403,且与"家庭不存在"同码(防探测)', async () => {
    const owner = await register('13700000004', '主人');
    const familyId = await createFamily(owner.token, '有主的家');
    services.instanceStore.add({ id: 'inst-4', familyId, status: 'doing' });

    const stranger = await register('13700000005', '外人');
    const denied = await upload({ token: stranger.token, familyId, instanceId: 'inst-4' });
    const unknown = await upload({ token: stranger.token, familyId: 'no-such-family', instanceId: 'inst-4' });

    expect(denied.statusCode).toBe(403);
    expect(unknown.statusCode).toBe(403);
    expect((unknown.json() as { error: string }).error).toBe((denied.json() as { error: string }).error);
    expect(services.proofMediaStore.count()).toBe(0);
  });

  it('任务已结算 -> 409,消息告诉用户该找谁', async () => {
    const owner = await register('13700000006', '结算爸爸');
    const familyId = await createFamily(owner.token, '结算之家');
    services.instanceStore.add({ id: 'inst-5', familyId, status: 'doing' });
    services.instanceStore.setStatus('inst-5', 'done');

    const response = await upload({ token: owner.token, familyId, instanceId: 'inst-5' });
    expect(response.statusCode).toBe(409);
    const body = response.json() as { error: string; message: string };
    expect(body.error).toBe('instance_already_settled');
    expect(body.message).toMatch(/家长|结算/);
  });

  it('没有文件部分 -> 400 no_file(与"文件不合法"是不同的错误)', async () => {
    const owner = await register('13700000007', '空手爸爸');
    const familyId = await createFamily(owner.token, '空手之家');
    services.instanceStore.add({ id: 'inst-6', familyId, status: 'doing' });

    const boundary = '----emptyboundary';
    const empty = Buffer.from(`--${boundary}--\r\n`, 'utf8');
    const response = await app.inject({
      method: 'POST',
      url: `/api/families/${familyId}/instances/inst-6/proof`,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        authorization: `Bearer ${owner.token}`,
      },
      payload: empty,
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: string }).error).toBe('no_file');
  });

  it('不认识的字节 -> 415', async () => {
    const owner = await register('13700000008', '乱传爸爸');
    const familyId = await createFamily(owner.token, '乱传之家');
    services.instanceStore.add({ id: 'inst-7', familyId, status: 'doing' });

    const response = await upload({
      token: owner.token,
      familyId,
      instanceId: 'inst-7',
      bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]),
      filename: 'virus.exe',
      contentType: 'application/octet-stream',
    });
    expect(response.statusCode).toBe(415);
    expect((response.json() as { error: string }).error).toBe('unsupported_media');
  });
});
