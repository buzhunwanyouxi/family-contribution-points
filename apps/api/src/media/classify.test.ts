/**
 * Proof-media validation tests (rule D7).
 *
 * The fixtures are hand-built magic bytes rather than real photos: D7's rules are about type and
 * size, both of which the first few bytes decide, and committing real family media is forbidden by
 * AGENTS.md prohibition 6. A 12-byte fake JPEG exercises exactly the same branch as a 300KB one.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  classifyMedia,
} from './classify.js';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

/** A payload of `size` bytes starting with the given signature. */
function withSignature(signature: number[], size: number): Uint8Array {
  const out = new Uint8Array(Math.max(size, signature.length));
  out.set(signature, 0);
  return out;
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const MP4 = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d];
const HEIC = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63];
const WEBM = [0x1a, 0x45, 0xdf, 0xa3];

describe('classifyMedia -- accepted types', () => {
  it.each([
    ['JPEG', JPEG, 'image/jpeg'],
    ['PNG', PNG, 'image/png'],
    ['WebP', WEBP, 'image/webp'],
    ['HEIC(iPhone 默认)', HEIC, 'image/heic'],
  ])('%s 被识别为图片', (_label, signature, contentType) => {
    const result = classifyMedia(withSignature(signature, 1024));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.media.kind).toBe('image');
      expect(result.media.contentType).toBe(contentType);
    }
  });

  it.each([
    ['MP4', MP4, 'video/mp4'],
    ['WebM', WEBM, 'video/webm'],
  ])('%s 被识别为视频', (_label, signature, contentType) => {
    const result = classifyMedia(withSignature(signature, 4096));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.media.kind).toBe('video');
      expect(result.media.contentType).toBe(contentType);
    }
  });

  it('记录真实字节数,不是声明的长度', () => {
    const result = classifyMedia(withSignature(JPEG, 1234));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.media.byteLength).toBe(1234);
  });
});

describe('classifyMedia -- rejections', () => {
  it('空文件被拒绝', () => {
    const result = classifyMedia(new Uint8Array(0));
    expect(result).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('不认识的字节被拒绝(不靠 Content-Type 蒙混过关)', () => {
    // 一个可执行文件的开头,但声称自己是图片
    const result = classifyMedia(bytes(0x4d, 0x5a, 0x90, 0x00), 'image/png');
    expect(result).toMatchObject({ ok: false, reason: 'unsupported_type' });
  });

  it('图片超过 300KB 被拒绝', () => {
    const result = classifyMedia(withSignature(JPEG, MAX_IMAGE_BYTES + 1));
    expect(result).toMatchObject({ ok: false, reason: 'too_large' });
    if (!result.ok) expect(result.message).toContain('照片太大');
  });

  it('图片刚好 300KB 可以通过(边界不误杀)', () => {
    expect(classifyMedia(withSignature(JPEG, MAX_IMAGE_BYTES)).ok).toBe(true);
  });

  it('视频超过 20MB 被拒绝', () => {
    const result = classifyMedia(withSignature(MP4, MAX_VIDEO_BYTES + 1));
    expect(result).toMatchObject({ ok: false, reason: 'too_large' });
    if (!result.ok) expect(result.message).toContain('视频太大');
  });

  it('视频的额度比图片大得多:一个 1MB 的文件当图片太大、当视频没问题', () => {
    expect(classifyMedia(withSignature(JPEG, 1024 * 1024)).ok).toBe(false);
    expect(classifyMedia(withSignature(MP4, 1024 * 1024)).ok).toBe(true);
  });

  it('声明的类型与真实字节矛盾时拒绝(前端传错字段的典型症状)', () => {
    const result = classifyMedia(withSignature(MP4, 2048), 'image/png');
    expect(result).toMatchObject({ ok: false, reason: 'declared_type_mismatch' });
  });

  it('声明 application/octet-stream 或空字符串时不参与判断(不是矛盾)', () => {
    expect(classifyMedia(withSignature(JPEG, 512), 'application/octet-stream').ok).toBe(true);
    expect(classifyMedia(withSignature(JPEG, 512), '').ok).toBe(true);
    expect(classifyMedia(withSignature(JPEG, 512)).ok).toBe(true);
  });

  it('声明得比真实更"宽"也拦:声称 image/* 但字节是视频', () => {
    expect(classifyMedia(withSignature(WEBM, 512), 'image/jpeg')).toMatchObject({
      ok: false,
      reason: 'declared_type_mismatch',
    });
  });
});
