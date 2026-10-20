/**
 * In-memory instance repository -- the development default (ADR-004: a cold clone must run with zero
 * setup).
 *
 * ## Why compare-and-set instead of read-then-write
 *
 * `claimIfOpen` and `settleIfPending` take the expected status and do the check-and-write in one
 * synchronous step. In this in-memory adapter there is no real concurrency, so the "atomicity" is
 * inheritance from the JavaScript event loop -- but the *interface* is what matters: it forces every
 * caller, including the Prisma adapter and every future one, to express claim and settle as
 * compare-and-set. A read-then-write service would compile fine against a naive interface and then
 * race in production (D1: two people must not both claim).
 *
 * The Prisma adapter achieves the same thing with `updateMany({ where: { id, status: expected } })` and
 * a row count check. Same contract, different mechanism.
 */
import { randomUUID } from 'node:crypto';
import type {
  ClaimPatch,
  CreateInstanceInput,
  InstanceRepository,
  SettlementPatch,
  TaskInstanceRecord,
} from './types.js';

export interface InMemoryInstanceRepositoryOptions {
  newId?: () => string;
}

export interface InMemoryInstanceRepository extends InstanceRepository {
  /** Test helper: how many rows exist, without going through the query API. */
  count(): number;
}

function clone(record: TaskInstanceRecord): TaskInstanceRecord {
  return { ...record };
}

export function createInMemoryInstanceRepository(
  options: InMemoryInstanceRepositoryOptions = {},
): InMemoryInstanceRepository {
  const rows = new Map<string, TaskInstanceRecord>();
  const newId = options.newId ?? (() => randomUUID());

  return {
    async create(input: CreateInstanceInput): Promise<TaskInstanceRecord> {
      const record: TaskInstanceRecord = {
        id: newId(),
        templateId: input.templateId ?? null,
        familyId: input.familyId,
        date: input.date,
        title: input.title,
        maxPoints: input.maxPoints,
        status: 'open',
        deadlineAt: input.deadlineAt,
        claimerId: null,
        claimedAt: null,
        autoAssigned: false,
        finalPercent: null,
        finalPoints: null,
        settledAt: null,
        settledBy: null,
        createdAt: new Date(),
      };
      rows.set(record.id, record);
      return clone(record);
    },

    async findById(instanceId: string): Promise<TaskInstanceRecord | null> {
      const row = rows.get(instanceId);
      return row === undefined ? null : clone(row);
    },

    async listByDate(familyId: string, date: string): Promise<TaskInstanceRecord[]> {
      return [...rows.values()]
        .filter((row) => row.familyId === familyId && row.date === date)
        // Deadline order is what a "today" screen wants: the next thing due sits on top.
        .sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime())
        .map(clone);
    },

    async listByFamily(familyId: string): Promise<TaskInstanceRecord[]> {
      return [...rows.values()]
        .filter((row) => row.familyId === familyId)
        .sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime())
        .map(clone);
    },

    async updateStatus(
      instanceId: string,
      expected: string,
      next: string,
    ): Promise<TaskInstanceRecord | null> {
      const row = rows.get(instanceId);
      if (row === undefined || row.status !== expected) return null;
      const updated: TaskInstanceRecord = { ...row, status: next as TaskInstanceRecord['status'] };
      rows.set(instanceId, updated);
      return clone(updated);
    },

    async claimIfOpen(
      instanceId: string,
      patch: ClaimPatch,
    ): Promise<TaskInstanceRecord | null> {
      const row = rows.get(instanceId);
      if (row === undefined || row.status !== 'open') return null;
      const updated: TaskInstanceRecord = {
        ...row,
        status: 'claimed',
        claimerId: patch.claimerId,
        claimedAt: patch.claimedAt,
        autoAssigned: patch.autoAssigned,
      };
      rows.set(instanceId, updated);
      return clone(updated);
    },

    async settleIfPending(
      instanceId: string,
      patch: SettlementPatch,
    ): Promise<TaskInstanceRecord | null> {
      const row = rows.get(instanceId);
      if (row === undefined || row.status !== 'pending_score') return null;
      const updated: TaskInstanceRecord = {
        ...row,
        status: patch.status,
        finalPercent: patch.finalPercent,
        finalPoints: patch.finalPoints,
        settledAt: patch.settledAt,
        settledBy: patch.settledBy,
      };
      rows.set(instanceId, updated);
      return clone(updated);
    },

    count(): number {
      return rows.size;
    },
  };
}
