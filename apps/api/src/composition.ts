/**
 * Composition root: the one place where modules are wired onto shared state.
 *
 * Why it exists
 * -------------
 * Every module defaults to its own in-memory repository so a fresh clone runs with zero setup
 * (ADR-004). That default is fine inside a module, but it silently breaks *between* modules: each
 * in-memory repository owns a private account table, so creating a family for an account that auth
 * had just registered failed with "cannot create a family for an unknown user" (HTTP 500).
 *
 * All 215 unit tests passed while that was true, because every suite builds its own fixtures inside
 * a single module. `composition.test.ts` walks the real HTTP surface of both modules and is what
 * keeps this honest.
 *
 * What it does
 * ------------
 * 1. builds one auth repository -- the single source of truth for accounts;
 * 2. mirrors accounts into the family repository: those seeded at start-up, and every one created
 *    later. Registration is the only place accounts are born (`repository.create`), so observing
 *    that single method closes the gap without touching either module's business logic;
 * 3. builds both services and the auth -> family directory hand-over.
 *
 * Scope limit (declared, not hidden)
 * ----------------------------------
 * This is a development-mode bridge, not the production design. With `DATABASE_URL` set both modules
 * read the same `User` table through Prisma and the problem does not exist at all. The proper end
 * state is a `UserDirectoryPort` on the family side, mirroring auth's `FamilyDirectoryPort`, so
 * there is one store instead of a synchronised pair. That change belongs to the family module and is
 * tracked as a requirement in `docs/coordination/PENDING.json`.
 */
import { createInMemoryAuthRepository } from './auth/repository.js';
import { createAuthService } from './auth/service.js';
import type { AuthRepository, AuthService, AuthUserRecord, CreateUserInput } from './auth/types.js';
import { createFamilyDirectory } from './family/directory.js';
import { createInMemoryFamilyRepository } from './family/repository.js';
import type { InMemoryFamilyRepository } from './family/repository.js';
import type { FamilyRepository } from './family/types.js';
import { createFamilyService } from './family/service.js';
import type { FamilyService } from './family/index.js';
import { createInMemoryProofMediaStore } from './media/store.js';
import type { ProofMediaStore } from './media/store.js';
import { createInMemoryMediaRepository, createMediaService } from './media/upload.js';
import type { InstanceReader, MediaRepository, MediaService } from './media/upload.js';
import { createInMemoryInstanceRepository } from './instances/repository.js';
import { createInstanceService } from './instances/service.js';
import type {
  InMemoryInstanceRepository,
  InstanceRepository,
  InstanceService,
} from './instances/index.js';

/** The shape the family module keeps for accounts it may have to resolve. */
interface DirectoryUser {
  id: string;
  nickname: string;
  avatarUrl: string | null;
}

export interface CreateAppServicesOptions {
  /** Accounts to pre-create. Only the in-memory adapter supports this today. */
  seedUsers?: readonly CreateUserInput[];
  /** JWT signing secret. Production resolves `JWT_SECRET` itself; tests pass one explicitly. */
  secret?: string;
  /**
   * Swap in a database-backed repository. When you do, mirroring is skipped: with Prisma both
   * modules already read the same `User` table, so there is nothing to keep in sync.
   */
  authRepository?: AuthRepository;
  /**
   * Signs evidence URLs (`GET /media/...`). Defaults to `secret` so tests that already pass a JWT
   * secret need no second knob; production should set a distinct one.
   */
  mediaAccessSecret?: string;
}

export interface AppServices {
  authService: AuthService;
  familyService: FamilyService;
  /** Exposed for diagnostics and tests, e.g. asserting both modules see the same accounts. */
  authRepository: AuthRepository;
  /**
   * Exposed deliberately as the *interface*, not the in-memory class: lane C's points route reads the
   * four numbers through `findMembership`, and widening the surface to the concrete type would invite
   * reaching into storage helpers that only exist in development.
   */
  familyRepository: FamilyRepository;
  /** lane C: proof-media upload (CONTRACTS #10). */
  mediaService: MediaService;
  /**
   * Exposed for tests and for the expiry cron that will delete blobs at T+72h. Both are the in-memory
   * dev adapters (ADR-004: a cold clone must run with zero setup); production swaps in durable ones
   * behind the same ports.
   */
  proofMediaStore: ProofMediaStore;
  mediaRepository: MediaRepository;
  /**
   * M1 (CONTRACTS #16/#17). The media module reads instances through a narrow `InstanceReader` port;
   * this is the real one -- the earlier placeholder in `media/instances.ts` is gone.
   */
  instanceService: InstanceService;
  /** Exposed for tests (seed fixtures) and for M3's generation job. */
  instanceRepository: InstanceRepository;
  /**
   * Passed through to the media routes so they verify exactly what the service signs.
   *
   * `undefined` means "both sides use their own development default", which is why the two defaults
   * are the same string and why `routes/media.ts` says so next to its copy. A cold clone therefore
   * works; production sets one value and both sides pick it up.
   */
  mediaAccessSecret: string | undefined;
}

function toDirectoryUser(row: AuthUserRecord): DirectoryUser {
  return { id: row.id, nickname: row.nickname, avatarUrl: row.avatarUrl };
}

/**
 * Wrap a repository so every account it holds is also visible to the family repository.
 *
 * Reads are delegated untouched; `create` and `findById` are observed so accounts born later are
 * mirrored too (the family module calls `findById` when it verifies an owner, so even a missed
 * create is repaired on first use). Nothing flows the other way: the family module never creates
 * accounts.
 *
 * Mirroring is best-effort on purpose -- a family-side failure must never make registration fail,
 * so failures are swallowed and the account is retried on its next read.
 */
export function createUserSyncingAuthRepository(
  inner: AuthRepository,
  mirror: Pick<InMemoryFamilyRepository, 'seedUser'>,
): AuthRepository {
  const seen = new Set<string>();

  function mirrorOnce(row: AuthUserRecord): void {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    try {
      mirror.seedUser(toDirectoryUser(row));
    } catch {
      seen.delete(row.id); // let a later call retry
    }
  }

  return {
    async findById(id) {
      const row = await inner.findById(id);
      if (row !== null) mirrorOnce(row);
      return row;
    },
    findByPhone: (phone) => inner.findByPhone(phone),
    findByEmail: (email) => inner.findByEmail(email),
    async create(input: CreateUserInput): Promise<AuthUserRecord> {
      const row = await inner.create(input);
      mirrorOnce(row);
      return row;
    },
  };
}

export function createAppServices(options: CreateAppServicesOptions = {}): AppServices {
  const inMemory = options.authRepository === undefined;
  const authRepository = options.authRepository ?? createInMemoryAuthRepository(options.seedUsers ?? []);
  const familyRepository = createInMemoryFamilyRepository();

  // With a database both modules share one table, so the mirror would be pointless indirection.
  const auth = inMemory
    ? createUserSyncingAuthRepository(authRepository, familyRepository)
    : authRepository;

  const familyService = createFamilyService({ repository: familyRepository });
  const authService = createAuthService({
    repository: auth,
    ...(options.secret === undefined ? {} : { secret: options.secret }),
    familyDirectory: createFamilyDirectory(familyService),
  });

  // ---------------------------------------------------------------------------------------------
  // M1 / instances (CONTRACTS #16/#17) + lane C / media (CONTRACTS #10).
  //
  // The instances module is now the real owner of TaskInstance. Media reads it through a narrow
  // `InstanceReader` port instead of importing the module, so upload keeps working without depending
  // on the claim/score/settle machinery -- and there is exactly one idea of what an instance is.
  // ---------------------------------------------------------------------------------------------
  const instanceRepository = createInMemoryInstanceRepository();
  const instanceService = createInstanceService({ repository: instanceRepository });

  /**
   * Adapter from the instance service to the media module's port.
   *
   * Two fields only, because that is all upload needs to answer its question ("does this instance
   * exist, in whose family, is it settled"). Passing the whole service would invite the media module
   * to claim or settle something, which is not its job.
   */
  const instanceReader: InstanceReader = {
    async findInstance(instanceId: string) {
      const record = await instanceRepository.findById(instanceId);
      if (record === null) return null;
      return { id: record.id, familyId: record.familyId, status: record.status };
    },
  };

  const proofMediaStore = createInMemoryProofMediaStore();
  const mediaRepository = createInMemoryMediaRepository();
  // Signed evidence URLs. Derived from the JWT secret when one is injected, so a test that passes a
  // secret gets matching signatures without a second knob; the default keeps a cold clone runnable.
  const mediaAccessSecret = options.mediaAccessSecret ?? options.secret ?? undefined;
  const mediaService = createMediaService({
    store: proofMediaStore,
    repository: mediaRepository,
    instances: instanceReader,
    ...(mediaAccessSecret === undefined ? {} : { accessSecret: mediaAccessSecret }),
  });

  return {
    authService,
    familyService,
    mediaService,
    instanceService,
    authRepository,
    familyRepository,
    proofMediaStore,
    mediaRepository,
    instanceRepository,
    mediaAccessSecret,
  };
}
