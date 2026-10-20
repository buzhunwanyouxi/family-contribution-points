/**
 * Proof-upload service tests (CONTRACTS #10, rules D7 / D8).
 *
 * Time is injected, so "72 hours" is asserted exactly rather than approximately -- the whole point of
 * writing `expireAt` at upload time is that it is a fact, not a prediction.
 *
 * Fixtures are magic bytes, not real media: D7's rules are about type and size, and AGENTS.md
 * prohibition 6 forbids committing real family photos.
 */
import { describe, expect, it } from 'vitest';
import { PROOF_TTL_HOURS } from '@fcp/shared';
import { createInMemoryProofMediaStore } from './store.js';
import { createInMemoryMediaRepository, createMediaService } from './upload.js';
import type { InstanceFacts, InstanceReader } from './upload.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(0)]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, ...new Array(400).fill(0)]);

const FAMILY = 'family-1';
const INSTANCE = 'instance-1';
const UPLOADER = 'user-1';
const NOW = new Date('2026-10-15T12:00:00.000Z');

/**
 * Minimal stand-in for the instance module's reader.
 *
 * Local to this file rather than shared: the media module only ever needs these three fields, and a
 * five-line fake that a reader can verify in one glance beats importing the real module into a unit
 * test (which would make this test depend on the entire state machine).
 */
function fakeInstances(facts: InstanceFacts): InstanceReader {
  return {
    async findInstance(instanceId: string) {
      return instanceId === facts.id ? { ...facts } : null;
    },
  };
}

function setup(options: { instanceFamily?: string; instanceStatus?: string } = {}) {
  const store = createInMemoryProofMediaStore();
  const repository = createInMemoryMediaRepository();
  const instances = fakeInstances({
    id: INSTANCE,
    familyId: options.instanceFamily ?? FAMILY,
    status: options.instanceStatus ?? 'doing',
  });

  let idCounter = 0;
  const service = createMediaService({
    store,
    repository,
    instances,
    now: () => NOW,
    newId: () => `media-${++idCounter}`,
  });

  return { service, store, repository, instances };
}

const upload = (service: ReturnType<typeof setup>['service'], bytes = JPEG, extra = {}) =>
  service.uploadProof({
    familyId: FAMILY,
    instanceId: INSTANCE,
    uploaderId: UPLOADER,
    bytes,
    ...extra,
  });

describe('uploadProof -- the happy path', () => {
  it('returns the frozen wire shape (CONTRACTS #10)', async () => {
    const { service } = setup();
    const view = await upload(service);

    expect(Object.keys(view).sort()).toEqual(
      // `access` is part of the frozen shape on purpose: the client rebuilds the signed query from it
      // when it re-fetches the evidence list, instead of parsing the signature back out of the url.
      [
        'access',
        'createdAt',
        'expireAt',
        'id',
        'refId',
        'refType',
        'sizeBytes',
        'type',
        'uploaderId',
        'url',
      ].sort(),
    );
    expect(view).toMatchObject({
      refType: 'instance',
      refId: INSTANCE,
      uploaderId: UPLOADER,
      type: 'image',
    });
  });

  it('★ expireAt 在上传时就写死为 uploadedAt + 72h(D8 的硬要求)', async () => {
    const { service } = setup();
    const view = await upload(service);

    expect(view.createdAt).toBe(NOW.toISOString());
    const expected = new Date(NOW.getTime() + PROOF_TTL_HOURS * 3_600_000).toISOString();
    expect(view.expireAt).toBe(expected);
    // 72 小时,不是别的时间;这条断言在 PROOF_TTL_HOURS 被误改时会红
    expect(PROOF_TTL_HOURS).toBe(72);
  });

  it('字节真的进了存储,而且元数据指向它', async () => {
    const { service, store, repository } = setup();
    const view = await upload(service);

    expect(store.count()).toBe(1);
    const [key] = store.keys();
    expect(key).toContain(FAMILY);
    expect(key).toContain(INSTANCE);

    const stored = await store.get(key!);
    expect(stored).not.toBeNull();
    expect(stored!.bytes.byteLength).toBe(JPEG.byteLength);
    expect(stored!.contentType).toBe('image/jpeg');

    const row = await repository.findById(view.id);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('valid');
    expect(row!.sizeBytes).toBe(JPEG.byteLength);
  });

  it('url 指向那个 blob,且不把原始 key 里的斜杠暴露成路径穿越', async () => {
    const { service } = setup();
    const view = await upload(service);
    expect(view.url.startsWith('/media/')).toBe(true);
    expect(view.url).not.toContain('..');
  });

  it('视频记成 video,并带上正确的大小', async () => {
    const { service } = setup();
    const view = await upload(service, MP4);
    expect(view.type).toBe('video');
    expect(view.sizeBytes).toBe(MP4.byteLength);
  });

  it('两次上传互不覆盖(同一任务可以有多张证据)', async () => {
    const { service, store, repository } = setup();
    const first = await upload(service);
    const second = await upload(service);

    expect(first.id).not.toBe(second.id);
    expect(store.count()).toBe(2);
    const rows = await repository.listByRef('instance', INSTANCE);
    expect(rows).toHaveLength(2);
  });
});

describe('uploadProof -- refusals', () => {
  it('实例不存在 -> 404(不区分"没有这个实例"和"不是这个家庭的实例")', async () => {
    const { service } = setup();
    await expect(
      service.uploadProof({
        familyId: FAMILY,
        instanceId: 'missing',
        uploaderId: UPLOADER,
        bytes: JPEG,
      }),
    ).rejects.toMatchObject({ code: 'instance_not_found', status: 404 });
  });

  it('★ 实例属于别的家庭 -> 同样是 404,不能靠 id 探测别人的任务', async () => {
    const { service } = setup({ instanceFamily: 'family-OTHER' });
    await expect(upload(service)).rejects.toMatchObject({
      code: 'instance_not_found',
      status: 404,
    });
  });

  it.each(['done', 'rejected', 'abandoned'])('已结算的任务(%s)不能再补证据 -> 409', async (status) => {
    const { service } = setup({ instanceStatus: status });
    await expect(upload(service)).rejects.toMatchObject({
      code: 'instance_already_settled',
      status: 409,
    });
  });

  it.each(['open', 'claimed', 'doing', 'pending_score'])('未结算的任务(%s)可以上传', async (status) => {
    const { service } = setup({ instanceStatus: status });
    await expect(upload(service)).resolves.toMatchObject({ type: 'image' });
  });

  it('★ 被拒绝时不留任何痕迹:没有 blob、没有元数据行', async () => {
    const { service, store, repository } = setup({ instanceStatus: 'done' });
    await expect(upload(service)).rejects.toThrow();
    expect(store.count()).toBe(0);
    expect(await repository.listByRef('instance', INSTANCE)).toHaveLength(0);
  });

  it('不认识的字节 -> 415,且不写存储', async () => {
    const { service, store } = setup();
    const junk = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
    await expect(upload(service, junk)).rejects.toMatchObject({
      code: 'unsupported_media',
      status: 415,
    });
    expect(store.count()).toBe(0);
  });

  it('超过 300KB 的图片 -> 413,消息里给出可执行的建议', async () => {
    const { service, store } = setup();
    const huge = new Uint8Array(300 * 1024 + 1);
    huge.set([0xff, 0xd8, 0xff], 0);

    const error = await upload(service, huge).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'media_too_large', status: 413 });
    expect((error as { message: string }).message).toContain('压缩');
    expect(store.count()).toBe(0);
  });

  it('声明的类型与字节矛盾 -> 415(前端传错字段的典型症状)', async () => {
    const { service } = setup();
    await expect(upload(service, JPEG, { declaredContentType: 'video/mp4' })).rejects.toMatchObject({
      code: 'unsupported_media',
    });
  });
});
