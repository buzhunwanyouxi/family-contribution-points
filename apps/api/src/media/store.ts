/**
 * Where the actual photo/video bytes live.
 *
 * The database keeps only metadata (see `ProofMedia`: refType/refId/uploaderId/type/url/expireAt/
 * status/deletedAt). PROJECT_GUIDE 4.10 is explicit that at T+72h "**文件本体与缩略图从对象存储删除**"
 * while a metadata row stays for auditing -- which only works if the bytes are somewhere other than
 * the row itself. That "somewhere" is this port.
 *
 * Why a port at all: the dev default must work on a fresh clone with zero setup (ADR-004), a test
 * must not write to disk, and production needs real object storage. Three requirements, three
 * adapters, one interface.
 *
 * Honest limitation of the in-memory adapter shipped here: **the bytes are gone when the process
 * restarts**, while the `ProofMedia` row (and its `url`) still claims they exist. That is acceptable
 * for `pnpm dev` and for tests, and unacceptable for anything a family actually relies on. Swapping in
 * a durable adapter is listed as the next step in the ops log rather than left to be discovered.
 */

export interface StoredMedia {
  /** Opaque key inside the store. Becomes part of the public URL. */
  key: string;
  byteLength: number;
  contentType: string;
  storedAt: Date;
}

export interface ProofMediaStore {
  put(input: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
    storedAt: Date;
  }): Promise<StoredMedia>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  /** Physical deletion at T+72h. Must be idempotent: the cron job may run again after a crash. */
  remove(key: string): Promise<void>;
  /** Diagnostics / tests: how many blobs are currently held. */
  count(): number;
}

export interface InMemoryProofMediaStore extends ProofMediaStore {
  /** Test helper: what is left after a deletion pass. */
  keys(): string[];
}

/**
 * Process-local store. Deliberately simple: a Map, no eviction, no size cap.
 *
 * Not a cache with a TTL -- deletion is driven by the expiry cron (D8/D9) so that the *decision*
 * to delete stays in one testable place (`expiry.ts`) instead of being duplicated as a timer here.
 */
export function createInMemoryProofMediaStore(): InMemoryProofMediaStore {
  const blobs = new Map<string, { bytes: Uint8Array; contentType: string; storedAt: Date }>();

  return {
    async put({ key, bytes, contentType, storedAt }) {
      blobs.set(key, { bytes, contentType, storedAt });
      return { key, byteLength: bytes.byteLength, contentType, storedAt };
    },

    async get(key) {
      const found = blobs.get(key);
      if (found === undefined) return null;
      return { bytes: found.bytes, contentType: found.contentType };
    },

    async remove(key) {
      blobs.delete(key);
    },

    count() {
      return blobs.size;
    },

    keys() {
      return [...blobs.keys()].sort();
    },
  };
}
