/**
 * Proof-media validation -- pure functions for rule D7.
 *
 * "图片前端压缩到约 300KB;视频限 15 秒 / 20MB" (PROJECT_GUIDE 4.10 / D7).
 *
 * Two decisions worth stating, because both are places where the obvious implementation is wrong:
 *
 *  1. **The type is decided by the file's magic bytes, not by the client's `Content-Type`.** A
 *     browser can claim anything; the only thing that tells you what the bytes actually are is the
 *     bytes. The declared MIME type is used for nothing except a fallback when the magic is unknown,
 *     and even then it cannot upgrade a file into being an image.
 *
 *  2. **The size limit is checked against the real byte length**, after the whole part has been read.
 *     `multipart` lets a client lie about `Content-Length`, and streaming straight to storage would
 *     mean discovering the problem after writing gigabytes. This service takes a buffer, so the
 *     caller must enforce a *transport* cap as well -- see the route, which limits the part size.
 *
 * Duration for videos is NOT verified here: it needs a container parser, and inventing one would be
 * a large amount of code whose failures are silent. The 15-second rule is enforced by the client,
 * which already has to decode the video to compress it, and the column is nullable so an absent
 * duration is honest rather than guessed. Recorded as a known gap in the ops log.
 */

/** Rule D7: images are compressed client-side to about this size; the server enforces the ceiling. */
export const MAX_IMAGE_BYTES = 300 * 1024;

/** Rule D7: videos are limited to 20MB. */
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

/** Rule D7: videos are limited to 15 seconds. Enforced client-side; see the file header. */
export const MAX_VIDEO_SECONDS = 15;

export type MediaKind = 'image' | 'video';

export interface ClassifiedMedia {
  kind: MediaKind;
  /** Normalised MIME type derived from the magic bytes. */
  contentType: string;
  byteLength: number;
}

export type RejectionReason =
  | 'unsupported_type'
  | 'too_large'
  | 'empty'
  | 'declared_type_mismatch';

export interface ClassifyFailure {
  ok: false;
  reason: RejectionReason;
  /** Human-readable Chinese, ready to show the user. */
  message: string;
}

export interface ClassifySuccess {
  ok: true;
  media: ClassifiedMedia;
}

export type ClassifyResult = ClassifySuccess | ClassifyFailure;

/**
 * Magic-byte signatures. Kept deliberately small: only what a phone camera actually produces
 * (JPEG / PNG / HEIC from iOS / WebP) plus the two video containers a browser will record.
 */
function sniff(bytes: Uint8Array): { kind: MediaKind; contentType: string } | null {
  const startsWith = (...sig: number[]): boolean =>
    bytes.length >= sig.length && sig.every((byte, index) => bytes[index] === byte);

  const ascii = (offset: number, text: string): boolean =>
    text.split('').every((char, index) => bytes[offset + index] === char.charCodeAt(0));

  if (startsWith(0xff, 0xd8, 0xff)) return { kind: 'image', contentType: 'image/jpeg' };
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { kind: 'image', contentType: 'image/png' };
  }
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { kind: 'image', contentType: 'image/webp' };
  // ISO-BMFF: `....ftyp<brand>`. Covers HEIC/HEIF (iPhone default) and MP4/MOV (browser recording).
  if (ascii(4, 'ftyp')) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (brand.startsWith('hei') || brand.startsWith('mif') || brand.startsWith('msf')) {
      return { kind: 'image', contentType: 'image/heic' };
    }
    if (brand.startsWith('qt')) return { kind: 'video', contentType: 'video/quicktime' };
    return { kind: 'video', contentType: 'video/mp4' };
  }
  // WebM / Matroska
  if (startsWith(0x1a, 0x45, 0xdf, 0xa3)) return { kind: 'video', contentType: 'video/webm' };
  return null;
}

/**
 * Decide whether these bytes are acceptable evidence.
 *
 * `declaredContentType` is only used to catch an obvious mismatch (a caller claiming `image/png` for
 * bytes that sniff as a video) -- it never lets a file through on its own.
 */
export function classifyMedia(bytes: Uint8Array, declaredContentType?: string): ClassifyResult {
  if (bytes.length === 0) {
    return { ok: false, reason: 'empty', message: '文件是空的,请重新选择' };
  }

  const sniffed = sniff(bytes);
  if (sniffed === null) {
    return {
      ok: false,
      reason: 'unsupported_type',
      message: '只支持照片(JPG/PNG/WebP/HEIC)或视频(MP4/MOV/WebM)',
    };
  }

  const limit = sniffed.kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (bytes.length > limit) {
    const mb = (limit / (1024 * 1024)).toFixed(limit < 1024 * 1024 ? 2 : 0);
    return {
      ok: false,
      reason: 'too_large',
      message:
        sniffed.kind === 'image'
          ? `照片太大了(上限 ${mb}MB),请在手机上压缩后重试`
          : `视频太大了(上限 ${mb}MB),请拍短一点`,
    };
  }

  // A declared type that contradicts the bytes is a client bug worth surfacing rather than ignoring:
  // it usually means the frontend is sending the wrong field or the wrong file.
  if (
    declaredContentType !== undefined &&
    declaredContentType !== '' &&
    declaredContentType !== 'application/octet-stream' &&
    !declaredContentType.startsWith(sniffed.kind === 'image' ? 'image/' : 'video/')
  ) {
    return {
      ok: false,
      reason: 'declared_type_mismatch',
      message: '文件类型与内容不符,请重新选择',
    };
  }

  return {
    ok: true,
    media: { kind: sniffed.kind, contentType: sniffed.contentType, byteLength: bytes.length },
  };
}
