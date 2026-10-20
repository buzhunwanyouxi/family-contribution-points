/**
 * The instance service -- the only entry point routes use.
 *
 * Every method here enforces, in this order:
 *   1. the instance belongs to the family in the URL (else 404, indistinguishable from missing);
 *   2. the requested transition is in the state machine (`state.ts`);
 *   3. the write is a compare-and-set, so two simultaneous callers cannot both win.
 *
 * Step 3 is the one that is easy to fake. Reading the row, checking `status === 'open'`, and then
 * writing is *not* a claim -- it is a race with extra steps. The repository interface only exposes
 * `claimIfOpen`, so this service physically cannot do it the wrong way.
 */
import { InstanceError } from './errors.js';
import { canTransition } from './state.js';
import type {
  CreateInstanceInput,
  InstanceRepository,
  TaskInstanceRecord,
} from './types.js';

export interface InstanceService {
  /** Create one instance. Exposed separately from generation so M3 can batch it. */
  create(input: CreateInstanceInput): Promise<TaskInstanceRecord>;
  /** Read one, scoped to a family. Throws 404 for "missing" and "other family" alike. */
  get(familyId: string, instanceId: string): Promise<TaskInstanceRecord>;
  /** One day's instances for a family (`. #16`). */
  listForDate(familyId: string, date: string): Promise<TaskInstanceRecord[]>;
  /** All instances of a family -- the "unsettled evidence" sweep (D8/E14) reads this. */
  listForFamily(familyId: string): Promise<TaskInstanceRecord[]>;

  /** `open -> claimed` (D1). Someone else winning the race is 409 `already_claimed`. */
  claim(familyId: string, instanceId: string, claimerId: string, now?: Date): Promise<TaskInstanceRecord>;
  /** Any live -> `abandoned`. Used when a task is called off. */
  abandon(familyId: string, instanceId: string): Promise<TaskInstanceRecord>;

  /**
   * Generic status move, used by M4/M5 (start / submit).
   *
   * `actorId` is required for transitions that only the claimer may perform; pass undefined for
   * transitions that any family member may trigger.
   */
  transition(
    familyId: string,
    instanceId: string,
    to: TaskInstanceRecord['status'],
    options?: { actorId?: string; now?: Date },
  ): Promise<TaskInstanceRecord>;
}

export interface CreateInstanceServiceOptions {
  repository: InstanceRepository;
  now?: () => Date;
}

export function createInstanceService(options: CreateInstanceServiceOptions): InstanceService {
  const { repository } = options;
  const now = options.now ?? (() => new Date());

  async function requireInstance(familyId: string, instanceId: string): Promise<TaskInstanceRecord> {
    const found = await repository.findById(instanceId);
    // `found === null` and `found.familyId !== familyId` collapse into one answer on purpose.
    if (found === null || found.familyId !== familyId) throw InstanceError.notFound();
    return found;
  }

  return {
    async create(input) {
      return repository.create(input);
    },

    async get(familyId, instanceId) {
      return requireInstance(familyId, instanceId);
    },

    async listForDate(familyId, date) {
      return repository.listByDate(familyId, date);
    },

    async listForFamily(familyId) {
      return repository.listByFamily(familyId);
    },

    async claim(familyId, instanceId, claimerId, at) {
      const current = await requireInstance(familyId, instanceId);

      // Already claimed by me? Idempotent -- a double tap should not be an error.
      if (current.status === 'claimed' && current.claimerId === claimerId) return current;

      if (current.status !== 'open') {
        // Someone else holds it -> the specific message; otherwise it is simply the wrong state.
        if (current.status === 'claimed' || current.status === 'doing') {
          throw InstanceError.alreadyClaimed();
        }
        throw InstanceError.invalidTransition(current.status, 'claimed');
      }

      const updated = await repository.claimIfOpen(instanceId, {
        claimerId,
        claimedAt: at ?? now(),
        autoAssigned: false,
      });
      // null here means somebody beat us between the read and the write.
      if (updated === null) throw InstanceError.alreadyClaimed();
      return updated;
    },

    async abandon(familyId, instanceId) {
      const current = await requireInstance(familyId, instanceId);
      const verdict = canTransition(current.status, 'abandoned');
      if (!verdict.ok) throw InstanceError.invalidTransition(current.status, 'abandoned');
      if (verdict.kind === 'noop') return current;

      const updated = await repository.updateStatus(instanceId, current.status, 'abandoned');
      if (updated === null) throw InstanceError.invalidTransition(current.status, 'abandoned');
      return updated;
    },

    async transition(familyId, instanceId, to, transitionOptions) {
      const current = await requireInstance(familyId, instanceId);
      const verdict = canTransition(current.status, to);
      if (!verdict.ok) throw InstanceError.invalidTransition(current.status, to);
      if (verdict.kind === 'noop') return current;

      // "Only the claimer may start / submit" -- releasing (-> open) is a separate path because a
      // deadline sweep may also release somebody else's instance.
      const actorId = transitionOptions?.actorId;
      if (actorId !== undefined && to !== 'open' && current.claimerId !== actorId) {
        throw InstanceError.notTheClaimer();
      }

      const updated = await repository.updateStatus(instanceId, current.status, to);
      if (updated === null) throw InstanceError.invalidTransition(current.status, to);
      return updated;
    },
  };
}
