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
  url: string;
  sizeBytes: number;
  /** ISO-8601. The UI counts down to this (D8/D9). */
  expireAt: string;
  createdAt: string;
}

export interface MediaRecord extends Omit<ProofMediaView, 'expireAt' | 'createdAt'> {
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
}

export interface CreateMediaServiceOptions {
  store: ProofMediaStore;
  repository: MediaRepository;
  instances: InstanceReader;
  /** Injectable for deterministic tests; defaults to the real clock. */
  now?: () => Date;
  newId?: () => string;
  /** Public base for `url`. Defaults to a same-origin path so the PWA can load it directly. */
  publicBasePath?: string;
}

const DEFAULT_PUBLIC_BASE = '/media';

/** Statuses that mean "this task is finished, evidence is closed" (mirrors `expiry.ts`). */
const SETTLED_STATUSES = new Set(['done', 'rejected', 'abandoned']);

export function createMediaService(options: CreateMediaServiceOptions): MediaService {
  const { store, repository, instances } = options;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const publicBase = options.publicBasePath ?? DEFAULT_PUBLIC_BASE;

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
      const record: MediaRecord = {
        id,
        refType: 'instance',
        refId: input.instanceId,
        uploaderId: input.uploaderId,
        type: classified.media.kind,
        url: `${publicBase}/${encodeURIComponent(key)}`,
        sizeBytes: stored.byteLength,
        expireAt: computeExpireAt(createdAt, PROOF_TTL_HOURS),
        status: 'valid',
        createdAt,
      };
      const saved = await repository.create(record);

      return toView(saved);
    },
  };
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
