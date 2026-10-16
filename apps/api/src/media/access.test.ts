/**
 * Signed-access tests.
 *
 * The cases that matter are the negative ones: a signature that leaks across files, one that can be
 * extended, and one that keeps working after the evidence is gone. Each has a specific way of being
 * wrong that looks fine in a happy-path test.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIGNATURE_TTL_MS,
  MAX_SIGNATURE_TTL_MS,
  issueAccess,
  verifyAccess,
  withAccess,
} from './access.js';

const SECRET = 'test-signing-secret';
const MEDIA = 'media-abc';
const NOW = new Date('2026-10-16T12:00:00.000Z');

describe('issueAccess / verifyAccess', () => {
  it('刚签发的令牌可以通过校验', () => {
    const access = issueAccess(SECRET, MEDIA, NOW);
    expect(verifyAccess(SECRET, MEDIA, access, NOW)).toEqual({ ok: true });
  });

  it('到期前一刻还能用,到点立刻失效(边界按 >= 判过期)', () => {
    const access = issueAccess(SECRET, MEDIA, NOW, 60_000);
    const justBefore = new Date(access.exp * 1000 - 1);
    const exactlyAt = new Date(access.exp * 1000);
    expect(verifyAccess(SECRET, MEDIA, access, justBefore)).toEqual({ ok: true });
    expect(verifyAccess(SECRET, MEDIA, access, exactlyAt)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('★ 令牌不能跨文件复用:换一个 mediaId 就失效', () => {
    const access = issueAccess(SECRET, MEDIA, NOW);
    expect(verifyAccess(SECRET, 'media-OTHER', access, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('★ 不能靠改 exp 延长有效期(签名覆盖了到期时间)', () => {
    const access = issueAccess(SECRET, MEDIA, NOW, 60_000);
    const tampered = { exp: access.exp + 86_400, sig: access.sig };
    expect(verifyAccess(SECRET, MEDIA, tampered, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('换一把密钥签的令牌无效', () => {
    const access = issueAccess('another-secret', MEDIA, NOW);
    expect(verifyAccess(SECRET, MEDIA, access, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('缺字段 / 空签名 / 非数字 exp 都算 malformed,不抛异常', () => {
    expect(verifyAccess(SECRET, MEDIA, {}, NOW)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyAccess(SECRET, MEDIA, { exp: 1, sig: '' }, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyAccess(SECRET, MEDIA, { exp: 'soon', sig: 'x' }, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('长度不同的签名不会让 timingSafeEqual 抛异常(必须先比长度)', () => {
    const access = issueAccess(SECRET, MEDIA, NOW);
    const short = { exp: access.exp, sig: access.sig.slice(0, 10) };
    expect(() => verifyAccess(SECRET, MEDIA, short, NOW)).not.toThrow();
    expect(verifyAccess(SECRET, MEDIA, short, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });
});

describe('有效期上限(D8 的 72 小时是硬顶)', () => {
  it('默认有效期是 6 小时,不是"永久"', () => {
    const access = issueAccess(SECRET, MEDIA, NOW);
    const ttlSeconds = access.exp - Math.floor(NOW.getTime() / 1000);
    expect(ttlSeconds).toBe(DEFAULT_SIGNATURE_TTL_MS / 1000);
  });

  it('★ 要 10 天也只给 72 小时 —— 链接不许比证据活得久', () => {
    const access = issueAccess(SECRET, MEDIA, NOW, 10 * 24 * 3_600_000);
    const ttlSeconds = access.exp - Math.floor(NOW.getTime() / 1000);
    expect(ttlSeconds).toBe(MAX_SIGNATURE_TTL_MS / 1000);
    // 而且确实在 72 小时后失效
    const after73h = new Date(NOW.getTime() + 73 * 3_600_000);
    expect(verifyAccess(SECRET, MEDIA, access, after73h)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('负数有效期被夹到 0(立即可用、立即失效),不会签出一个"过去"的令牌', () => {
    const access = issueAccess(SECRET, MEDIA, NOW, -1000);
    expect(access.exp).toBe(Math.floor(NOW.getTime() / 1000));
    expect(verifyAccess(SECRET, MEDIA, access, NOW)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('withAccess', () => {
  it('拼到没有查询串的 url 上用 ?', () => {
    const url = withAccess('/media/a/b/c', { exp: 123, sig: 'deadbeef' });
    expect(url).toBe('/media/a/b/c?exp=123&sig=deadbeef');
  });

  it('已有查询串时用 &,不覆盖原有参数', () => {
    const url = withAccess('/media/a/b/c?download=1', { exp: 123, sig: 'deadbeef' });
    expect(url).toBe('/media/a/b/c?download=1&exp=123&sig=deadbeef');
  });
});
