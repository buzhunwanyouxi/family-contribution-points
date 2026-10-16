/**
 * CONTRACTS #10 -- `POST /api/families/:fid/instances/:iid/proof`: attach evidence to a task.
 *
 * Behaviour that matters, and why:
 *
 *  - **`expireAt` is computed and written at upload time** (D8). A later sweep that "fills in" the
 *    deadline would leave a window where evidence has no expiry, and the deletion job keys off this
 *    column. `computeExpireAt` comes from `expiry.ts` so the rule has one implementation.
 *  - **Evidence for an already-settled task is refused** (409). D8/E14 says deletion must never block
 *    scoring, but the reverse is not symmetric: once points are awarded, letting someone attach new
 *    evidence would reopen a decision that was already made. The message tells the user to ask a
 *    parent rather than just saying no.
 *  - **Type and size are judged from the bytes** (`classify.ts`), never from what the client claims.
 *
 * What this does NOT do: video duration. D7 limits clips to 15 seconds, and verifying that needs a
 * container parser. The column is nullable, so an unknown duration is recorded as unknown rather than
 * guessed at, and the gap is written down in the ops log.
 */
import { PROOF_TTL_HOURS } from '@fcp/shared';
import { DEFAULT_SIGNATURE_TTL_MS, issueAccess, withAccess } from './access.js';
import type { SignedAccess } from './access.js';
import { classifyMedia } from './classify.js';
import { MediaError } from './errors.js';
import { computeExpireAt } from './expiry.js';
import type { ProofMediaStore } from './store.js';

/** The wire shape of one piece of evidence (mirrors the `ProofMedia` row, minus internals). */
export interface ProofMediaView {
  id: string;
  /** `instance` today; the column exists because tasks can carry evidence too. */
  refType: string;
  refId: string;
  uploaderId: string;
  type: 'image' | 'video';
  /**
   * Storage location. Deliberately **unsigned**: the signature is issued when a response is built,
   * so a row stored six hours ago never hands out a link that expired in the meantime.
   */
  url: string;
  sizeBytes: number;
  /** ISO-8601. The UI counts down to this (D8/D9). */
  expireAt: string;
  createdAt: string;
  /** Signed query for `url`. Present on upload responses; rebuilt on every read. */
  access?: SignedAccess;
}

export interface MediaRecord extends Omit<ProofMediaView, 'expireAt' | 'createdAt' | 'access'> {
  expireAt: Date;
  createdAt: Date;
  status: 'valid' | 'expired';
}

export interface MediaRepository {
  create(record: MediaRecord): Promise<MediaRecord>;
  findById(id: string): Promise<MediaRecord | null>;
  /** Newest first -- the evidence list on a task card. */
  listByRef(refType: string, refId: string): Promise<MediaRecord[]>;
}

export interface InstanceFacts {
  id: string;
  familyId: string;
  status: string;
}

/**
 * How the upload path learns about a task instance.
 *
 * Kept as a narrow port rather than importing the task module: this module only needs to know
 * "does this instance exist, in whose family, and is it settled", and depending on the whole task
 * module would couple two lanes that are being written in parallel.
 */
export interface InstanceReader {
  findInstance(instanceId: string): Promise<InstanceFacts | null>;
}

export interface UploadProofInput {
  familyId: string;
  instanceId: string;
  uploaderId: string;
  bytes: Uint8Array;
  /** Advisory only -- see `classify.ts`. Used to catch a contradictory declaration, never to allow. */
  declaredContentType?: string;
  durationSec?: number;
}

export interface MediaService {
  uploadProof(input: UploadProofInput): Promise<ProofMediaView>;
  /**
   * Fetch evidence that the caller has already been authorised for.
   *
   * Deliberately does NOT re-check membership: two different callers reach here (a signed URL used
   * by `<img src>`, and a Bearer token used by the download button), and only the route knows which.
   * Doing the check here would mean doing it twice, in two places, with two chances to disagree.
   * What the service owns is the *existence* rule, which is the same for both.
   */
  readProof(mediaId: string): Promise<ProofBytes>;
}

/** Bytes plus the metadata a response needs. */
export interface ProofBytes {
  bytes: Uint8Array;
  contentType: string;
  /** `attachment` when the caller asked to download, otherwise `inline` (phone cameras preview). */
  disposition: 'inline' | 'attachment';
  /** Suggested filename for downloads. */
  filename: string;
}

export interface CreateMediaServiceOptions {
  store: ProofMediaStore;
  repository: MediaRepository;
  instances: InstanceReader;
  /**
   * Signs evidence URLs. Same reasoning as the JWT secret: a development default keeps a cold clone
   * runnable, and production must set it.
   */
  accessSecret?: string;
  /** How long a signed URL stays valid. Clamped to the evidence lifetime; see `access.ts`. */
  signatureTtlMs?: number;
  /** Injectable for deterministic tests; defaults to the real clock. */
  now?: () => Date;
  newId?: () => string;
  /** Public base for `url`. Defaults to a same-origin path so the PWA can load it directly. */
  publicBasePath?: string;
}

const DEFAULT_PUBLIC_BASE = '/media';

/**
 * Development default. A cold clone must run with zero setup (ADR-004); production sets a real secret.
 * Declared here rather than in `access.ts` so the service has one obvious place for its config.
 */
const DEFAULT_ACCESS_SECRET = 'dev-only-media-access-secret-change-me';

/** Statuses that mean "this task is finished, evidence is closed" (mirrors `expiry.ts`). */
const SETTLED_STATUSES = new Set(['done', 'rejected', 'abandoned']);

export function createMediaService(options: CreateMediaServiceOptions): MediaService {
  const { store, repository, instances } = options;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const publicBase = options.publicBasePath ?? DEFAULT_PUBLIC_BASE;
  const accessSecret = options.accessSecret ?? DEFAULT_ACCESS_SECRET;

  /**
   * Build the response view for a stored row.
   *
   * `url` and `access` are **two independent things, not a pair to be concatenated twice**:
   *   - `url` is the storage location, already carrying its signature;
   *   - `access` is the same signature on its own, so a client that re-fetches the evidence list can
   *     rebuild the query without parsing it back out of the url.
   *
   * Earlier this returned `url` *and* an `access` meant to be appended to it, which produced
   * `?exp=..&sig=..?exp=..&sig=..` for any client that did the obvious thing. The rule is therefore:
   * **`url` is directly fetchable; `access` is for rebuilding, never for concatenating onto `url`.**
   */
  function viewOf(record: MediaRecord, disposition: 'inline' | 'attachment' = 'inline'): ProofMediaView {
    const base = toView(record);
    const target = disposition === 'inline' ? base.url : `${base.url}?download=1`;
    const access = issueAccess(
      accessSecret,
      record.id,
      now(),
      options.signatureTtlMs ?? DEFAULT_SIGNATURE_TTL_MS,
    );
    return { ...base, url: withAccess(target, access), access };
  }

  return {
    async uploadProof(input: UploadProofInput): Promise<ProofMediaView> {
      // 1. The instance must exist AND belong to the family in the URL. An instance from another
      //    family answers exactly like a missing one, so ids cannot be probed across families.
      const instance = await instances.findInstance(input.instanceId);
      if (instance === null || instance.familyId !== input.familyId) {
        throw MediaError.instanceNotFound();
      }

      // 2. Settled task -> evidence closed (see the file header).
      if (SETTLED_STATUSES.has(instance.status)) {
        throw MediaError.instanceSettled();
      }

      const classified = classifyMedia(input.bytes, input.declaredContentType);
      if (!classified.ok) {
        // The classifier's message is already user-facing Chinese; carry it through instead of
        // flattening three different problems into one generic error.
        if (classified.reason === 'too_large') {
          throw MediaError.tooLarge(classified.message, { reason: classified.reason });
        }
        throw MediaError.unsupportedMedia({ reason: classified.reason, message: classified.message });
      }

      const createdAt = now();
      const id = newId();
      const key = `${input.familyId}/${input.instanceId}/${id}`;

      // 3. Store the bytes first; if this throws, no metadata row is written and nothing dangles.
      const stored = await store.put({
        key,
        bytes: input.bytes,
        contentType: classified.media.contentType,
        storedAt: createdAt,
      });

      // 4. `expireAt` is written here, at upload time (D8).
      //
      // The url is deliberately NOT percent-encoded. Encoding the key turned every `/` into `%2F`,
      // making the path a single opaque segment and forcing a decode on the way back in -- which then
      // double-decoded, because Fastify already decodes wildcard params. Keys are built from ids this
      // code generates, so there is nothing in them that needs escaping.
      const record: MediaRecord = {
        id,
        refType: 'instance',
        refId: input.instanceId,
        uploaderId: input.uploaderId,
        type: classified.media.kind,
        url: `${publicBase}/${key}`,
        sizeBytes: stored.byteLength,
        expireAt: computeExpireAt(createdAt, PROOF_TTL_HOURS),
        status: 'valid',
        createdAt,
      };
      const saved = await repository.create(record);

      return viewOf(saved);
    },

    async readProof(mediaId: string): Promise<ProofBytes> {
      const record = await repository.findById(mediaId);

      // Two different reasons to answer "gone", and both must look identical to the client:
      //  - the row itself is gone (never existed, or physically purged at T+72h)
      //  - the row is a tombstone: D8 keeps the metadata for auditing after the bytes are deleted
      // A distinguishable answer here would confirm that some other family's media id exists.
      if (record === null || record.status !== 'valid') throw MediaError.mediaGone();

      // The 72-hour deadline is enforced on READ, not only by the deletion job. The job might not have
      // run yet (or might be down); the rule is about the evidence being viewable for 72 hours, so the
      // boundary belongs here where it cannot be skipped.
      if (record.expireAt.getTime() <= now().getTime()) throw MediaError.mediaGone();

      const blob = await store.get(keyOf(record));
      // Metadata without bytes happens when storage is not durable (the in-memory default). Reporting
      // it as "gone" is honest from the user's side; reporting it as a 500 would be a lie about whose
      // fault it is.
      if (blob === null) throw MediaError.mediaGone();

      const extension = extensionFor(blob.contentType);
      return {
        bytes: blob.bytes,
        contentType: blob.contentType,
        disposition: 'inline',
        filename: `proof-${record.id}${extension}`,
      };
    },
  };

  /** The storage key is the part of `url` after the public base. Not encoded -- see `uploadProof`. */
  function keyOf(record: MediaRecord): string {
    return record.url.slice(publicBase.length + 1);
  }
}

/** Best-effort extension for download filenames. Only affects what the file is called. */
function extensionFor(contentType: string): string {
  switch (contentType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/heic':
      return '.heic';
    case 'video/mp4':
      return '.mp4';
    case 'video/quicktime':
      return '.mov';
    case 'video/webm':
      return '.webm';
    default:
      return '';
  }
}

/** Map the stored record to the wire shape (`expireAt`/`createdAt` become ISO strings). */
export function toView(record: MediaRecord): ProofMediaView {
  return {
    id: record.id,
    refType: record.refType,
    refId: record.refId,
    uploaderId: record.uploaderId,
    type: record.type,
    url: record.url,
    sizeBytes: record.sizeBytes,
    expireAt: record.expireAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

/** In-memory metadata rows, the dev default alongside `createInMemoryProofMediaStore`. */
export function createInMemoryMediaRepository(): MediaRepository {
  const rows = new Map<string, MediaRecord>();

  return {
    async create(record) {
      rows.set(record.id, { ...record });
      return { ...record };
    },
    async findById(id) {
      const row = rows.get(id);
      return row === undefined ? null : { ...row };
    },
    async listByRef(refType, refId) {
      return [...rows.values()]
        .filter((row) => row.refType === refType && row.refId === refId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((row) => ({ ...row }));
    },
  };
}
