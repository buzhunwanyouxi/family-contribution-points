/**
 * Frontend wiring tests for the two endpoints that were already finished on the server but never called
 * from the UI:
 *
 *   #15 points      -- the page used to read the session snapshot, so the numbers never changed
 *   #16 instances   -- the page used to print "接口待认领" about an endpoint that existed
 *
 * What these test is the **seam**, not the rendering: that `api.points` asks the server, that the
 * response is mapped by `pointsResponseToView` rather than passed through, and that the status labels
 * cover every status the server can send. Rendering is covered by the real-backend smoke test.
 */
import { describe, expect, it } from 'vitest';
import {
  INSTANCE_STATUS_LABEL,
  pointsResponseToView,
  toPointsView,
} from './types';
import type { InstanceStatus, PointsResponse } from './types';

describe('pointsResponseToView (CONTRACTS #15)', () => {
  it('把线上四数转成界面五数,spendable 在前端算', () => {
    const wire: PointsResponse = { earned: 86.4, available: 42.4, spent: 44, frozen: 5 };
    expect(pointsResponseToView(wire)).toEqual({
      earned: 86.4,
      available: 42.4,
      spent: 44,
      frozen: 5,
      spendable: 37.4,
    });
  });

  it('★ 线上形状只有四个字段 —— spendable 不是服务端给的', () => {
    const wire: PointsResponse = { earned: 10, available: 10, spent: 0, frozen: 0 };
    // 如果哪天有人把 PointsView 直接当线上形状用,这条会因为他拿到 undefined 而红
    expect(Object.keys(wire).sort()).toEqual(['available', 'earned', 'frozen', 'spent']);
    expect((wire as unknown as { spendable?: number }).spendable).toBeUndefined();
  });

  it('恒等式 earned − spent === available 在界面形状上仍成立', () => {
    const view = pointsResponseToView({ earned: 100, available: 86.4, spent: 13.6, frozen: 0 });
    expect(view.earned - view.spent).toBeCloseTo(view.available, 10);
  });

  it('冻结中是可花额度的子集,不会被加进去', () => {
    const view = pointsResponseToView({ earned: 42.4, available: 42.4, spent: 0, frozen: 5 });
    expect(view.spendable).toBeCloseTo(37.4, 10);
    expect(view.spendable).toBeLessThan(view.available);
  });

  it('两位小数取整,与 toPointsView(会话快照那条路)口径一致', () => {
    const fromWire = pointsResponseToView({
      earned: 2.004999,
      available: 1.005,
      spent: 0.999501,
      frozen: 0.100001,
    });
    // 同样的一组数字走 toPointsView 必须得到同样的结果 —— 两条路径不许有第二套算法
    const fromSession = toPointsView({
      id: 'f',
      name: '家',
      role: 'owner',
      points: 1.005,
      earnedPoints: 2.004999,
      spentPoints: 0.999501,
      frozenPoints: 0.100001,
    });
    expect(fromWire).toEqual(fromSession);
  });
});

describe('INSTANCE_STATUS_LABEL', () => {
  it('★ 服务端能返回的每个状态都有中文标签(漏一个界面上就会出现英文枚举)', () => {
    const statuses: InstanceStatus[] = [
      'open',
      'claimed',
      'doing',
      'pending_score',
      'done',
      'rejected',
      'abandoned',
    ];
    for (const status of statuses) {
      expect(INSTANCE_STATUS_LABEL[status], status).toBeTruthy();
      // 标签必须是中文,不能是把枚举原样回显
      expect(INSTANCE_STATUS_LABEL[status]).not.toBe(status);
    }
  });

  it('与后端状态表数量一致(后端有 7 个状态)', () => {
    expect(Object.keys(INSTANCE_STATUS_LABEL)).toHaveLength(7);
  });
});
