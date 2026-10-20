/**
 * Instance service tests -- the behaviour routes rely on.
 *
 * The cases that matter:
 *  - claim is a compare-and-set, so two claimers cannot both win (D1);
 *  - a family's instances are invisible through another family's id (防探测);
 *  - illegal transitions come back as 409 with a machine code, not a generic 400.
 */
import { describe, expect, it } from 'vitest';
import { createInMemoryInstanceRepository } from './repository.js';
import { createInstanceService } from './service.js';
import type { CreateInstanceInput } from './types.js';

const FAMILY = 'family-1';
const OTHER_FAMILY = 'family-2';
const DATE = '2026-10-20';

function setup() {
  let seq = 0;
  const repository = createInMemoryInstanceRepository({ newId: () => `inst-${++seq}` });
  const service = createInstanceService({ repository });
  return { repository, service };
}

const draft = (overrides: Partial<CreateInstanceInput> = {}): CreateInstanceInput => ({
  familyId: FAMILY,
  date: DATE,
  title: '洗碗',
  maxPoints: 3,
  deadlineAt: new Date('2026-10-20T13:00:00.000Z'),
  ...overrides,
});

describe('create / read', () => {
  it('新实例是 open,且结算字段为空(还没发生的事不写值)', async () => {
    const { service } = setup();
    const created = await service.create(draft());

    expect(created).toMatchObject({
      status: 'open',
      claimerId: null,
      claimedAt: null,
      autoAssigned: false,
      finalPercent: null,
      finalPoints: null,
      settledAt: null,
      settledBy: null,
      templateId: null,
    });
  });

  it('按日期列出该家庭的实例', async () => {
    const { service } = setup();
    await service.create(draft({ title: '洗碗', deadlineAt: new Date('2026-10-20T13:00:00.000Z') }));
    await service.create(draft({ title: '扫地', deadlineAt: new Date('2026-10-20T11:00:00.000Z') }));
    await service.create(draft({ title: '明天的事', date: '2026-10-21' }));

    const list = await service.listForDate(FAMILY, DATE);
    expect(list).toHaveLength(2);
    // 截止时间早的排前面 —— 今日页最想看"下一个到点的是什么"
    expect(list.map((i) => i.title)).toEqual(['扫地', '洗碗']);
  });

  it('★ 别人的家庭读不到(404,与"不存在"同码)', async () => {
    const { service } = setup();
    const created = await service.create(draft());

    await expect(service.get(OTHER_FAMILY, created.id)).rejects.toMatchObject({
      code: 'instance_not_found',
      status: 404,
    });
    await expect(service.get(FAMILY, 'nope')).rejects.toMatchObject({
      code: 'instance_not_found',
      status: 404,
    });
  });
});

describe('claim(D1)', () => {
  it('open -> claimed,记下谁接的、什么时候', async () => {
    const { service } = setup();
    const created = await service.create(draft());
    const at = new Date('2026-10-20T10:00:00.000Z');

    const claimed = await service.claim(FAMILY, created.id, 'kid-1', at);
    expect(claimed).toMatchObject({
      status: 'claimed',
      claimerId: 'kid-1',
      claimedAt: at,
      autoAssigned: false,
    });
  });

  it('★ 别人再抢 -> 409 already_claimed(不是 400,UI 要能分开处理)', async () => {
    const { service } = setup();
    const created = await service.create(draft());
    await service.claim(FAMILY, created.id, 'kid-1');

    await expect(service.claim(FAMILY, created.id, 'kid-2')).rejects.toMatchObject({
      code: 'already_claimed',
      status: 409,
    });
  });

  it('★ 同一个人重复抢 -> 幂等成功,不报错', async () => {
    const { service } = setup();
    const created = await service.create(draft());
    const first = await service.claim(FAMILY, created.id, 'kid-1');
    const second = await service.claim(FAMILY, created.id, 'kid-1');
    expect(second.claimerId).toBe('kid-1');
    expect(second.claimedAt).toEqual(first.claimedAt);
  });

  it('★ 并发抢同一实例:只有一个能成', async () => {
    // 内存仓储没有真实并发,但两个同时发出的 claim 仍必须只有一个成功 ——
    // 这条断言的是"先到者赢了之后,后到者拿到 409",而不是两边都返回成功。
    const { service } = setup();
    const created = await service.create(draft());

    const [a, b] = await Promise.allSettled([
      service.claim(FAMILY, created.id, 'kid-1'),
      service.claim(FAMILY, created.id, 'kid-2'),
    ]);

    const winners = [a, b].filter((r) => r.status === 'fulfilled');
    const losers = [a, b].filter((r) => r.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'already_claimed' });
  });

  it('已结算的任务不能被抢(409,不是 already_claimed)', async () => {
    const { service, repository } = setup();
    const created = await service.create(draft());
    await repository.updateStatus(created.id, 'open', 'pending_score');

    await expect(service.claim(FAMILY, created.id, 'kid-1')).rejects.toMatchObject({
      code: 'invalid_status_transition',
      status: 409,
    });
  });
});

describe('transition(状态机的人工闸门)', () => {
  it('claimer 可以 claimed -> doing -> pending_score', async () => {
    const { service } = setup();
    const created = await service.create(draft());
    await service.claim(FAMILY, created.id, 'kid-1');

    const doing = await service.transition(FAMILY, created.id, 'doing', { actorId: 'kid-1' });
    expect(doing.status).toBe('doing');

    const submitted = await service.transition(FAMILY, created.id, 'pending_score', {
      actorId: 'kid-1',
    });
    expect(submitted.status).toBe('pending_score');
  });

  it('★ 不是接单人 -> 403 not_the_claimer', async () => {
    const { service } = setup();
    const created = await service.create(draft());
    await service.claim(FAMILY, created.id, 'kid-1');

    await expect(
      service.transition(FAMILY, created.id, 'doing', { actorId: 'kid-2' }),
    ).rejects.toMatchObject({ code: 'not_the_claimer', status: 403 });
  });

  it('★ 非法流转 -> 409 invalid_status_transition,带上 from/to 便于排查', async () => {
    const { service } = setup();
    const created = await service.create(draft());

    const error = await service
      .transition(FAMILY, created.id, 'done')
      .catch((e: unknown) => e as { code: string; status: number; details: unknown });
    expect(error).toMatchObject({
      code: 'invalid_status_transition',
      status: 409,
      details: { from: 'open', to: 'done' },
    });
  });

  it('重复设置同一状态是幂等的(双击不报错)', async () => {
    const { service } = setup();
    const created = await service.create(draft());
    await service.claim(FAMILY, created.id, 'kid-1');
    await service.transition(FAMILY, created.id, 'doing', { actorId: 'kid-1' });

    const again = await service.transition(FAMILY, created.id, 'doing', { actorId: 'kid-1' });
    expect(again.status).toBe('doing');
  });

  it('claimed -> open(15 分钟内退单)不需要是接单人 —— 超时释放也要走这条路', async () => {
    const { service } = setup();
    const created = await service.create(draft());
    await service.claim(FAMILY, created.id, 'kid-1');

    // 故意不传 actorId:系统释放(超时)与本人退单共用同一条路径
    const released = await service.transition(FAMILY, created.id, 'open');
    expect(released.status).toBe('open');
  });
});

describe('abandon(任何活态都能作废)', () => {
  it.each(['open', 'claimed', 'doing', 'pending_score'])('%s -> abandoned', async (from) => {
    const { service, repository } = setup();
    const created = await service.create(draft());
    // 走到目标状态
    if (from === 'claimed' || from === 'doing' || from === 'pending_score') {
      await service.claim(FAMILY, created.id, 'kid-1');
    }
    if (from === 'doing' || from === 'pending_score') {
      await service.transition(FAMILY, created.id, 'doing', { actorId: 'kid-1' });
    }
    if (from === 'pending_score') {
      await service.transition(FAMILY, created.id, 'pending_score', { actorId: 'kid-1' });
    }
    const before = await repository.findById(created.id);
    expect(before?.status).toBe(from);

    const abandoned = await service.abandon(FAMILY, created.id);
    expect(abandoned.status).toBe('abandoned');
  });

  it('★ 已结算的任务不能作废(否则积分记录会和任务状态矛盾)', async () => {
    const { service, repository } = setup();
    const created = await service.create(draft());
    await repository.updateStatus(created.id, 'open', 'pending_score');
    await repository.settleIfPending(created.id, {
      status: 'done',
      finalPercent: 100,
      finalPoints: 3,
      settledAt: new Date(),
      settledBy: 'owner',
    });

    await expect(service.abandon(FAMILY, created.id)).rejects.toMatchObject({
      code: 'invalid_status_transition',
      status: 409,
    });
  });
});

describe('仓储的 compare-and-set(竞态的最后一道闸)', () => {
  it('claimIfOpen 在状态不是 open 时返回 null,而不是覆盖', async () => {
    const { repository } = setup();
    const created = await repository.create(draft());
    await repository.claimIfOpen(created.id, {
      claimerId: 'kid-1',
      claimedAt: new Date(),
      autoAssigned: false,
    });

    const second = await repository.claimIfOpen(created.id, {
      claimerId: 'kid-2',
      claimedAt: new Date(),
      autoAssigned: false,
    });
    expect(second).toBeNull();

    const stored = await repository.findById(created.id);
    expect(stored?.claimerId).toBe('kid-1');
  });

  it('settleIfPending 只在 pending_score 时生效', async () => {
    const { repository } = setup();
    const created = await repository.create(draft());
    const patch = {
      status: 'done' as const,
      finalPercent: 100,
      finalPoints: 3,
      settledAt: new Date(),
      settledBy: 'owner' as const,
    };

    // 还是 open,不能结算
    expect(await repository.settleIfPending(created.id, patch)).toBeNull();

    await repository.updateStatus(created.id, 'open', 'pending_score');
    expect(await repository.settleIfPending(created.id, patch)).not.toBeNull();

    // 第二次结算必须失败(不能重复加分)
    expect(await repository.settleIfPending(created.id, patch)).toBeNull();
  });
});
