/**
 * State-machine tests.
 *
 * The value of this file is the *negative* cases. A green happy path proves the table has arrows; it
 * does not prove the arrows are the right ones. The cases below are chosen so that each one fails if
 * somebody "simplifies" the table.
 */
import { describe, expect, it } from 'vitest';
import {
  FREE_CANCEL_WINDOW_MS,
  canTransition,
  isLive,
  isOverdue,
  isTerminal,
  isWithinFreeCancel,
  nextStatuses,
} from './state.js';
import { OPEN_STATUSES, TERMINAL_STATUSES } from './types.js';
import type { InstanceStatus } from './types.js';

const ALL: InstanceStatus[] = [
  'open',
  'claimed',
  'doing',
  'pending_score',
  'done',
  'rejected',
  'abandoned',
];

describe('canTransition -- the happy path', () => {
  it('open→claimed→doing→pending_score→done 每一步都允许', () => {
    expect(canTransition('open', 'claimed')).toEqual({ ok: true, kind: 'change' });
    expect(canTransition('claimed', 'doing')).toEqual({ ok: true, kind: 'change' });
    expect(canTransition('doing', 'pending_score')).toEqual({ ok: true, kind: 'change' });
    expect(canTransition('pending_score', 'done')).toEqual({ ok: true, kind: 'change' });
  });

  it('pending_score 可以被判为 rejected(结算为未完成)', () => {
    expect(canTransition('pending_score', 'rejected')).toEqual({ ok: true, kind: 'change' });
  });
});

describe('canTransition -- ★ 必须拒绝的(跳过中间态)', () => {
  it('★ open 不能直接跳到 done —— 这是最容易写漏的一条', () => {
    expect(canTransition('open', 'done')).toEqual({ ok: false });
  });

  it('★ open 不能直接跳到 pending_score(没干活就交活)', () => {
    expect(canTransition('open', 'pending_score')).toEqual({ ok: false });
  });

  it('★ claimed 不能直接结算(没提交就打分)', () => {
    expect(canTransition('claimed', 'done')).toEqual({ ok: false });
    expect(canTransition('claimed', 'pending_score')).toEqual({ ok: false });
  });

  it('★ 终态是终态:done / rejected / abandoned 出不去', () => {
    for (const terminal of TERMINAL_STATUSES) {
      for (const target of ALL) {
        const verdict = canTransition(terminal, target);
        // 终态 -> 自己 是 noop(幂等),终态 -> 别的任何状态 必须被拒绝
        if (terminal === target) {
          expect(verdict, `${terminal} -> ${target}`).toEqual({ ok: true, kind: 'noop' });
        } else {
          expect(verdict, `${terminal} -> ${target}`).toEqual({ ok: false });
        }
      }
    }
  });

  it('★ 已完成的任务不能回到 open(那会允许重复领分)', () => {
    expect(canTransition('done', 'open')).toEqual({ ok: false });
  });
});

describe('canTransition -- 幂等', () => {
  it.each(ALL)('%s -> 自己 是 noop 而不是错误', (status) => {
    expect(canTransition(status, status)).toEqual({ ok: true, kind: 'noop' });
  });

  it('★ 为什么 noop 不算非法:连点两次"开始"不应报错', () => {
    // 这条测试是防回归的:如果有人把 noop 改成 { ok: false },
    // 前端双击按钮就会看到一个"状态已变"的错误,而实际上什么都没错。
    expect(canTransition('doing', 'doing').ok).toBe(true);
  });
});

describe('isTerminal / isLive', () => {
  it('三个终态与四个活态一一对应', () => {
    for (const status of ALL) {
      expect(isTerminal(status), status).toBe(TERMINAL_STATUSES.includes(status));
      expect(isLive(status), status).toBe(!TERMINAL_STATUSES.includes(status));
    }
  });

  it('TERMINAL_STATUSES 与状态表不脱节(改表时会红)', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(nextStatuses(status)).toHaveLength(0);
    }
    for (const status of OPEN_STATUSES) {
      expect(nextStatuses(status).length, status).toBeGreaterThan(0);
    }
  });
});

describe('D2 免费退单窗口(15 分钟)', () => {
  const claimedAt = new Date('2026-10-20T10:00:00.000Z');

  it('刚接单 -> 在窗口内', () => {
    expect(isWithinFreeCancel(claimedAt, new Date('2026-10-20T10:00:01.000Z'))).toBe(true);
  });

  it('14 分 59 秒 -> 仍在窗口内', () => {
    const almost = new Date(claimedAt.getTime() + FREE_CANCEL_WINDOW_MS - 1000);
    expect(isWithinFreeCancel(claimedAt, almost)).toBe(true);
  });

  it('★ 正好 15 分 00 秒 -> 已经出窗口(边界不给额外宽容)', () => {
    const exactly = new Date(claimedAt.getTime() + FREE_CANCEL_WINDOW_MS);
    expect(isWithinFreeCancel(claimedAt, exactly)).toBe(false);
  });

  it('15 分 01 秒 -> 出窗口', () => {
    const past = new Date(claimedAt.getTime() + FREE_CANCEL_WINDOW_MS + 1000);
    expect(isWithinFreeCancel(claimedAt, past)).toBe(false);
  });

  it('窗口长度就是 15 分钟(单位写错会红)', () => {
    expect(FREE_CANCEL_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});

describe('isOverdue(D3 / D5)', () => {
  const deadline = new Date('2026-10-20T13:00:00.000Z');

  it('提前一分钟 -> 未到期', () => {
    expect(isOverdue(deadline, new Date('2026-10-20T12:59:00.000Z'))).toBe(false);
  });

  it('★ 正好到点 -> 已到期(D5 说的是"到点仍无人接")', () => {
    expect(isOverdue(deadline, deadline)).toBe(true);
  });

  it('过点 -> 已到期', () => {
    expect(isOverdue(deadline, new Date('2026-10-20T13:00:01.000Z'))).toBe(true);
  });
});
