/**
 * Prisma adapter for the instance persistence port.
 *
 * Same structural choice as `family/repository.prisma.ts` and `auth/repository.prisma.ts`: it does
 * **not** import `@prisma/client`, so `pnpm -r typecheck` stays green before `db:generate` has ever run.
 * The delegate surface below is exactly the subset of `prisma.taskInstance` this module uses; changing
 * `schema.prisma` in a way that breaks any of them is a contract change.
 *
 * ## How compare-and-set is achieved here
 *
 * The in-memory adapter gets atomicity for free from the event loop. Postgres does not grant that, so
 * claim and settle use `updateMany({ where: { id, status: expected }, data })` and check `count`:
 *
 *   - `count === 1` -> we won the race;
 *   - `count === 0` -> the row moved (or vanished) between our read and our write.
 *
 * `update` would have set the row unconditionally and quietly turned a lost race into an overwrite.
 * That is the whole reason the port exposes `claimIfOpen` / `settleIfPending` instead of `update`.
 */
import type {
  ClaimPatch,
  CreateInstanceInput,
  InstanceRepository,
  InstanceStatus,
  SettledBy,
  SettlementPatch,
  TaskInstanceRecord,
} from './types.js';

/** `model TaskInstance` as Prisma returns it. */
export interface PrismaInstanceRow {
  id: string;
  templateId: string | null;
  familyId: string;
  date: Date;
  title: string;
  maxPoints: number;
  deadlineAt: Date;
  status: string;
  claimerId: string | null;
  claimedAt: Date | null;
  autoAssigned: boolean;
  finalPercent: number | null;
  finalPoints: number | null;
  settledAt: Date | null;
  settledBy: string | null;
  createdAt: Date;
}

/** The subset of `prisma.taskInstance` used here. */
export interface PrismaTaskInstanceDelegate {
  create(args: { data: Record<string, unknown> }): Promise<PrismaInstanceRow>;
  findUnique(args: { where: { id: string } }): Promise<PrismaInstanceRow | null>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
  }): Promise<PrismaInstanceRow[]>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

export interface PrismaInstanceClient {
  taskInstance: PrismaTaskInstanceDelegate;
}

/**
 * `schema.prisma` stores `date` as `DateTime`. The port uses `YYYY-MM-DD` because an instance belongs
 * to a natural day, not an instant -- "the 20th" is not `2026-10-20T00:00:00Z` in every timezone.
 * These two helpers are the only place the translation happens.
 */
function dateToRow(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function dateFromRow(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toRecord(row: PrismaInstanceRow): TaskInstanceRecord {
  return {
    id: row.id,
    templateId: row.templateId,
    familyId: row.familyId,
    date: dateFromRow(row.date),
    title: row.title,
    maxPoints: row.maxPoints,
    status: row.status as InstanceStatus,
    deadlineAt: row.deadlineAt,
    claimerId: row.claimerId,
    claimedAt: row.claimedAt,
    autoAssigned: row.autoAssigned,
    finalPercent: row.finalPercent,
    finalPoints: row.finalPoints,
    settledAt: row.settledAt,
    settledBy: row.settledBy as SettledBy | null,
    createdAt: row.createdAt,
  };
}

export function createPrismaInstanceRepository(client: PrismaInstanceClient): InstanceRepository {
  const delegate = client.taskInstance;

  /**
   * Declared as a local function, not `this.findById`, on purpose: a caller that destructures the
   * repository (`const { claimIfOpen } = repo`) would get `this === undefined` and lose the row it just
   * wrote. Local bindings cannot be detached like that.
   */
  async function findById(instanceId: string): Promise<TaskInstanceRecord | null> {
    const row = await delegate.findUnique({ where: { id: instanceId } });
    return row === null ? null : toRecord(row);
  }

  return {
    async create(input: CreateInstanceInput): Promise<TaskInstanceRecord> {
      const row = await delegate.create({
        data: {
          templateId: input.templateId ?? null,
          familyId: input.familyId,
          date: dateToRow(input.date),
          title: input.title,
          maxPoints: input.maxPoints,
          deadlineAt: input.deadlineAt,
          status: 'open',
          claimerId: null,
          claimedAt: null,
          autoAssigned: false,
          finalPercent: null,
          finalPoints: null,
          settledAt: null,
          settledBy: null,
        },
      });
      return toRecord(row);
    },

    findById,

    async listByDate(familyId: string, date: string): Promise<TaskInstanceRecord[]> {
      const rows = await delegate.findMany({
        where: { familyId, date: dateToRow(date) },
        orderBy: { deadlineAt: 'asc' },
      });
      return rows.map(toRecord);
    },

    async listByFamily(familyId: string): Promise<TaskInstanceRecord[]> {
      const rows = await delegate.findMany({
        where: { familyId },
        orderBy: { deadlineAt: 'asc' },
      });
      return rows.map(toRecord);
    },

    async updateStatus(
      instanceId: string,
      expected: InstanceStatus,
      next: InstanceStatus,
    ): Promise<TaskInstanceRecord | null> {
      const result = await delegate.updateMany({
        where: { id: instanceId, status: expected },
        data: { status: next },
      });
      // Lost race or missing row -- the caller distinguishes via findById if it needs to.
      if (result.count !== 1) return null;
      return findById(instanceId);
    },

    async claimIfOpen(
      instanceId: string,
      patch: ClaimPatch,
    ): Promise<TaskInstanceRecord | null> {
      const result = await delegate.updateMany({
        where: { id: instanceId, status: 'open' },
        data: {
          status: 'claimed',
          claimerId: patch.claimerId,
          claimedAt: patch.claimedAt,
          autoAssigned: patch.autoAssigned,
        },
      });
      if (result.count !== 1) return null;
      return findById(instanceId);
    },

    async settleIfPending(
      instanceId: string,
      patch: SettlementPatch,
    ): Promise<TaskInstanceRecord | null> {
      const result = await delegate.updateMany({
        where: { id: instanceId, status: 'pending_score' },
        data: {
          status: patch.status,
          finalPercent: patch.finalPercent,
          finalPoints: patch.finalPoints,
          settledAt: patch.settledAt,
          settledBy: patch.settledBy,
        },
      });
      if (result.count !== 1) return null;
      return findById(instanceId);
    },
  };
}
