/**
 * M3 tests -- the four criteria from `MVP-MODULES.md`, plus the timezone traps that make them non-obvious.
 *
 * Every case uses a fixed date and a fixed instant. Nothing here reads the real clock or the machine's
 * zone, because the whole point of M3 is that "today" is a decision, not an accident.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCalendarDay,
  calendarDayInZone,
  generateForDate,
  parseCalendarDay,
  runGeneration,
  zonedTimeToUtc,
} from './generate.js';
import { createInMemoryInstanceRepository } from './repository.js';
import { InstanceError } from './errors.js';
import type { TaskTemplateRecord } from '../template/types.js';

const SHANGHAI = 'Asia/Shanghai';

/** A complete, valid template; override only the field under test. */
function template(overrides: Partial<TaskTemplateRecord> = {}): TaskTemplateRecord {
  return {
    id: 'tpl-1',
    familyId: 'fam-1',
    title: '洗碗',
    description: null,
    timeOfDay: '14:00',
    repeatRule: 'daily',
    maxPoints: 3,
    assignMode: 'claim',
    claimerScope: 'all',
    mustBeClaimed: true,
    remindBeforeMin: 15,
    status: 'active',
    createdBy: 'user-1',
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

// 2026-10-19 Mon · 10-20 Tue · 10-21 Wed · 10-23 Fri · 10-25 Sun (verified, not assumed)
const MON = '2026-10-19';
const TUE = '2026-10-20';
const WED = '2026-10-21';
const FRI = '2026-10-23';
const SUN = '2026-10-25';

describe('calendarDayInZone -- 问题 1:此刻在这个时区是哪一天', () => {
  it('★ 同一瞬间,上海已经是 21 号,伦敦还在 20 号', () => {
    const instant = new Date('2026-10-20T17:00:00.000Z');
    expect(calendarDayInZone(instant, SHANGHAI)).toBe('2026-10-21');
    expect(calendarDayInZone(instant, 'Europe/London')).toBe('2026-10-20');
  });

  it('★ 跨零点那条线:上海 08:00 之前,UTC 还是前一天', () => {
    // 2026-10-19T16:00Z == 2026-10-20 00:00 上海
    expect(calendarDayInZone(new Date('2026-10-19T15:59:59.999Z'), SHANGHAI)).toBe('2026-10-19');
    expect(calendarDayInZone(new Date('2026-10-19T16:00:00.000Z'), SHANGHAI)).toBe('2026-10-20');
  });

  it('UTC 时区直读', () => {
    expect(calendarDayInZone(new Date('2026-10-20T23:30:00.000Z'), 'UTC')).toBe('2026-10-20');
  });

  it('非法时区 -> validation_error,不是静默回退到服务器时区', () => {
    expect(() => calendarDayInZone(new Date(), 'Mars/Olympus')).toThrow(InstanceError);
    expect(() => calendarDayInZone(new Date(), '')).toThrow(InstanceError);
  });
});

describe('zonedTimeToUtc -- 把"家庭时区的墙上时间"换成瞬间', () => {
  it('上海 14:00 是 UTC 06:00', () => {
    expect(zonedTimeToUtc(TUE, '14:00', SHANGHAI).toISOString()).toBe('2026-10-20T06:00:00.000Z');
  });

  it('UTC 时区就是它自己', () => {
    expect(zonedTimeToUtc(TUE, '14:00', 'UTC').toISOString()).toBe('2026-10-20T14:00:00.000Z');
  });

  it('00:00 上海 = 前一天 16:00Z(边界不要错到前一天)', () => {
    expect(zonedTimeToUtc(TUE, '00:00', SHANGHAI).toISOString()).toBe('2026-10-19T16:00:00.000Z');
  });

  it('23:59 上海 = 15:59Z(同一天)', () => {
    expect(zonedTimeToUtc(TUE, '23:59', SHANGHAI).toISOString()).toBe('2026-10-20T15:59:00.000Z');
  });

  it('有夏令时的时区:同一墙上时间在夏天和冬天是不同的瞬间', () => {
    const summer = zonedTimeToUtc('2026-07-15', '14:00', 'Europe/London');
    const winter = zonedTimeToUtc('2026-01-15', '14:00', 'Europe/London');
    // 夏天 BST(+1) -> 13:00Z;冬天 GMT(+0) -> 14:00Z
    expect(summer.toISOString()).toBe('2026-07-15T13:00:00.000Z');
    expect(winter.toISOString()).toBe('2026-01-15T14:00:00.000Z');
  });

  it('★ 非法 timeOfDay -> 抛错,不静默改成 00:00', () => {
    for (const bad of ['25:00', '14:60', '1400', '', '2:00', '14:00:00']) {
      expect(() => zonedTimeToUtc(TUE, bad, SHANGHAI), bad).toThrow(InstanceError);
    }
  });

  it('★ 不存在的日期 -> 抛错,不被 Date 悄悄滚到 3 月', () => {
    expect(() => zonedTimeToUtc('2026-02-31', '14:00', SHANGHAI)).toThrow(InstanceError);
    expect(() => parseCalendarDay('2026-13-01')).toThrow(InstanceError);
  });
});

describe('buildCalendarDay -- 为什么不直接传瞬间给 shouldFireOn', () => {
  it('★ 本地 getters 必须读回同一天,否则星期几会错一天', () => {
    const day = buildCalendarDay(TUE);
    expect(day.getFullYear()).toBe(2026);
    expect(day.getMonth()).toBe(9); // 0-based
    expect(day.getDate()).toBe(20);
    // 2026-10-20 是周二
    expect(day.getDay()).toBe(2);
  });

  it('闰年 2 月 29 日可构造', () => {
    const day = buildCalendarDay('2024-02-29');
    expect(day.getMonth()).toBe(1);
    expect(day.getDate()).toBe(29);
  });
});

describe('★ 判据 1:幂等 -- 同一天跑两次,实例数不变', () => {
  it('generateForDate 是纯函数:同样的输入两次得到同样的输出', () => {
    const templates = [template()];
    const first = generateForDate(templates, TUE, SHANGHAI);
    const second = generateForDate(templates, TUE, SHANGHAI);

    expect(second).toHaveLength(first.length);
    expect(second.map((d) => d.templateId)).toEqual(first.map((d) => d.templateId));
    expect(second.map((d) => d.deadlineAt.toISOString())).toEqual(
      first.map((d) => d.deadlineAt.toISOString()),
    );
  });

  it('★ 输出顺序稳定(否则"两次一致"可能只是碰巧)', () => {
    const templates = [
      template({ id: 'tpl-b', title: 'B', timeOfDay: '18:00' }),
      template({ id: 'tpl-a', title: 'A', timeOfDay: '08:00' }),
      template({ id: 'tpl-c', title: 'C', timeOfDay: '08:00' }), // 与 A 同时间
    ];
    const drafts = generateForDate(templates, TUE, SHANGHAI);
    // 先按时间,再按标题 -> 08:00 A、08:00 C、18:00 B
    expect(drafts.map((d) => d.templateId)).toEqual(['tpl-a', 'tpl-c', 'tpl-b']);
  });

  it('“幂等”这一层只保证**产出**稳定;去重靠仓储的 (templateId,date) 唯一性', () => {
    // 这条是边界说明,不是断言实现细节:generateForDate 对同一个模板总会产出一条草稿,
    // 所以"同一天不重复"必须由落库那一步保证。这里钉住这个前提,防止有人以为纯函数自己会去重。
    const drafts = generateForDate([template()], TUE, SHANGHAI);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.templateId).toBe('tpl-1');
  });
});

describe('★ 判据 2:暂停的模板不生成', () => {
  it('paused 不生成', () => {
    expect(generateForDate([template({ status: 'paused' })], TUE, SHANGHAI)).toHaveLength(0);
  });

  it('archived 不生成', () => {
    expect(generateForDate([template({ status: 'archived' })], TUE, SHANGHAI)).toHaveLength(0);
  });

  it('active 生成', () => {
    expect(generateForDate([template({ status: 'active' })], TUE, SHANGHAI)).toHaveLength(1);
  });

  it('混在一起时只出 active 的那几条', () => {
    const templates = [
      template({ id: 'a', status: 'active' }),
      template({ id: 'p', status: 'paused' }),
      template({ id: 'x', status: 'archived' }),
    ];
    const drafts = generateForDate(templates, TUE, SHANGHAI);
    expect(drafts.map((d) => d.templateId)).toEqual(['a']);
  });
});

describe('★ 判据 3:weekly:1,3,5 只在周一/三/五生成', () => {
  const rule = template({ repeatRule: 'weekly:1,3,5' });

  it('周一、周三、周五生成', () => {
    for (const day of [MON, WED, FRI]) {
      expect(generateForDate([rule], day, SHANGHAI), day).toHaveLength(1);
    }
  });

  it('★ 周二/周四/周六/周日不生成', () => {
    for (const day of [TUE, '2026-10-22', '2026-10-24', SUN]) {
      expect(generateForDate([rule], day, SHANGHAI), day).toHaveLength(0);
    }
  });

  it('★ weekly:7 只在周日生成(复用 repeat.ts 的 ISO 口径,不自己算)', () => {
    const sundayRule = template({ repeatRule: 'weekly:7' });
    expect(generateForDate([sundayRule], SUN, SHANGHAI)).toHaveLength(1);
    expect(generateForDate([sundayRule], '2026-10-24', SHANGHAI)).toHaveLength(0); // 周六
  });

  it('monthly:31 在 2 月不生成也不抛错', () => {
    const monthly = template({ repeatRule: 'monthly:31' });
    expect(generateForDate([monthly], '2026-02-28', SHANGHAI)).toHaveLength(0);
    expect(generateForDate([monthly], '2026-01-31', SHANGHAI)).toHaveLength(1);
  });

  it('daily 每天都生成', () => {
    const daily = template({ repeatRule: 'daily' });
    for (const day of [MON, TUE, WED, SUN]) {
      expect(generateForDate([daily], day, SHANGHAI), day).toHaveLength(1);
    }
  });

  it('★ 规则坏掉的模板被跳过,而不是让整批任务都生成不出来', () => {
    const broken = template({ id: 'bad', repeatRule: 'weekly:99' });
    const good = template({ id: 'ok', repeatRule: 'daily' });
    const drafts = generateForDate([broken, good], TUE, SHANGHAI);
    expect(drafts.map((d) => d.templateId)).toEqual(['ok']);
  });
});

describe('★ 判据 4:时区按家庭设置', () => {
  it('同一个 date 字符串,不同时区给出不同的 deadlineAt 瞬间', () => {
    const shanghai = generateForDate([template()], TUE, SHANGHAI)[0]!;
    const utc = generateForDate([template()], TUE, 'UTC')[0]!;
    expect(shanghai.deadlineAt.toISOString()).toBe('2026-10-20T06:00:00.000Z');
    expect(utc.deadlineAt.toISOString()).toBe('2026-10-20T14:00:00.000Z');
  });

  it('★ 时区不影响"星期几"的判定(日历事实与时区无关)', () => {
    const rule = template({ repeatRule: 'weekly:1,3,5' });
    for (const zone of [SHANGHAI, 'UTC', 'Europe/London', 'America/New_York']) {
      expect(generateForDate([rule], MON, zone), zone).toHaveLength(1);
      expect(generateForDate([rule], TUE, zone), zone).toHaveLength(0);
    }
  });
});

describe('草稿的字段搬运', () => {
  it('title / maxPoints / familyId / templateId / date 原样搬过来', () => {
    const draft = generateForDate(
      [template({ id: 'tpl-9', title: '倒垃圾', maxPoints: 2.5, familyId: 'fam-9' })],
      TUE,
      SHANGHAI,
    )[0]!;

    expect(draft).toMatchObject({
      templateId: 'tpl-9',
      familyId: 'fam-9',
      title: '倒垃圾',
      maxPoints: 2.5,
      date: TUE,
    });
  });

  it('空模板列表 -> 空草稿,不抛错', () => {
    expect(generateForDate([], TUE, SHANGHAI)).toEqual([]);
  });

  it('date 前后空格被容忍并规范化', () => {
    expect(generateForDate([template()], `  ${TUE}  `, SHANGHAI)[0]!.date).toBe(TUE);
  });
});

describe('★ 判据 1(真幂等):runGeneration 同一天跑两次,实例数不变', () => {
  /** Fresh in-memory repository per test -- the module's own `count()` is how we assert row growth. */
  function makeRepo() {
    let seq = 0;
    const repo = createInMemoryInstanceRepository({ newId: () => `inst-${++seq}` });
    return { repo, count: () => repo.count() };
  }

  async function run(
    repo: ReturnType<typeof makeRepo>['repo'],
    templates: TaskTemplateRecord[],
    date: string,
    timeZone = SHANGHAI,
  ) {
    return runGeneration({ repository: repo, templates, date, timeZone });
  }

  it('★ 跑两次:第一次 created=2,第二次 created=0 / skipped=2,库里的行数不变', async () => {
    const { repo, count } = makeRepo();
    const templates = [template({ id: 'a' }), template({ id: 'b', title: '扫地' })];

    const first = await run(repo, templates, TUE);
    expect(first.created).toBe(2);
    expect(first.skipped).toBe(0);
    const afterFirst = count();
    expect(afterFirst).toBe(2);

    const second = await run(repo, templates, TUE);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(2);
    expect(count(), '第二次跑完实例数必须不变').toBe(afterFirst);
  });

  it('★ 第二次拿回的是同一批实例 id,不是新建的两条', async () => {
    const { repo } = makeRepo();
    const templates = [template({ id: 'a' })];

    const first = await run(repo, templates, TUE);
    const second = await run(repo, templates, TUE);

    expect(second.instances.map((i) => i.id)).toEqual(first.instances.map((i) => i.id));
  });

  it('★ 两次都是"成功",不是"第二次报错"(定时作业重试不能变成失败)', async () => {
    const { repo } = makeRepo();
    const templates = [template()];
    await expect(run(repo, templates, TUE)).resolves.toBeDefined();
    await expect(run(repo, templates, TUE)).resolves.toBeDefined();
  });

  it('不同日期互不干扰:昨天生成过,今天照样生成', async () => {
    const { repo, count } = makeRepo();
    const templates = [template()];

    await run(repo, templates, MON);
    expect(count()).toBe(1);

    const today = await run(repo, templates, TUE);
    expect(today.created).toBe(1);
    expect(count()).toBe(2);
  });

  it('★ 新增一个模板后重跑:只补那一条,老的 2 条不动', async () => {
    const { repo, count } = makeRepo();

    await run(repo, [template({ id: 'a' }), template({ id: 'b', title: '扫地' })], TUE);
    expect(count()).toBe(2);

    const third = await run(
      repo,
      [template({ id: 'a' }), template({ id: 'b', title: '扫地' }), template({ id: 'c', title: '擦桌' })],
      TUE,
    );
    expect(third.created).toBe(1);
    expect(third.skipped).toBe(2);
    expect(count()).toBe(3);
  });

  it('★ 并发跑两次(同时发起)也只产生 N 条,不是 2N 条', async () => {
    const { repo, count } = makeRepo();
    const templates = [template({ id: 'a' }), template({ id: 'b', title: '扫地' })];

    // 两条真实并发:定时作业重试时就是这个形状。
    await Promise.all([run(repo, templates, TUE), run(repo, templates, TUE)]);

    expect(count(), '并发下也不能重复建').toBe(2);
  });

  it('暂停的模板即使重跑也不产生实例', async () => {
    const { repo, count } = makeRepo();
    await run(repo, [template({ status: 'paused' })], TUE);
    expect(count()).toBe(0);
  });

  it('生成的实例初始状态是 open,没有认领人', async () => {
    const { repo } = makeRepo();
    const summary = await run(repo, [template()], TUE);
    expect(summary.instances[0]).toMatchObject({
      status: 'open',
      claimerId: null,
      claimedAt: null,
      autoAssigned: false,
      finalPercent: null,
      finalPoints: null,
    });
  });

  it('summary 带回日期与时区,便于调用方记录"哪一天按哪个时区跑的"', async () => {
    const { repo } = makeRepo();
    const summary = await run(repo, [template()], TUE);
    expect(summary.date).toBe(TUE);
    expect(summary.timeZone).toBe(SHANGHAI);
  });
});
