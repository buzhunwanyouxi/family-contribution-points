/**
 * 最小自检:证明 apps/web 的 vitest 能跑,且**不需要任何外部服务**。
 *
 * 它的存在有两个作用:
 *  1. 隔离问题 —— 如果冒烟测试卡住而这条通过,说明卡的是"起服务/网络"那一层,不是 vitest 本身;
 *  2. 给 web 包一个**任何环境下都能跑**的测试,`pnpm -r test` 不会因为起不了服务而红。
 */
import { describe, expect, it } from 'vitest';
import { USE_MOCK, apiUrl } from './config';
import { ROLE_LABEL, toPointsView } from './types';

describe('web 包基础自检(不需要服务)', () => {
  it('配置模块能加载:mock 开关与 apiUrl 有确定行为', () => {
    expect(typeof USE_MOCK).toBe('boolean');
    expect(apiUrl('/api/auth/me')).toBe('/api/auth/me');
  });

  it('角色标签覆盖契约里的四种角色', () => {
    expect(Object.keys(ROLE_LABEL).sort()).toEqual(['admin', 'child', 'member', 'owner']);
  });

  it('积分四个数字的展示口径(F2/F6 v1.3):可花 = 可用 − 冻结', () => {
    const view = toPointsView({
      id: 'f1',
      name: '家',
      role: 'owner',
      points: 42.4,
      earnedPoints: 86.4,
      spentPoints: 44,
      frozenPoints: 5,
    });
    expect(view).toEqual({ earned: 86.4, available: 42.4, spent: 44, frozen: 5, spendable: 37.4 });
    // 恒等式必须永远成立:累计获得 − 已消费 = 当前可用
    expect(view.earned - view.spent).toBeCloseTo(view.available, 10);
  });
});
