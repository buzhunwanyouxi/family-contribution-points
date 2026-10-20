/**
 * In-memory implementation of `TemplateRepository`.
 *
 * This is the default when none is injected, which is what keeps `pnpm --filter @fcp/api test` and a
 * fresh `pnpm dev` running with **zero database setup** (ADR-004). It is a real implementation, not a
 * mock: it enforces the invariants the database would (`id` unique, a status can only be set on a row
 * that exists in the given family) so a use case that passes here does not fail only in production.
 *
 * Every read returns a clone. Without that, a test could mutate "storage" through a returned object
 * and then pass for the wrong reason -- exactly the class of false green this project has been bitten
 * by before (`composition.ts` header, 2026-10-13 token incident).
 */
import { randomUUID } from 'node:crypto';
import type {
  CreateTemplateInput,
  TaskTemplateRecord,
  TemplateRepository,
  TemplateStatus,
} from './types.js';

export interface InMemoryTemplateRepositoryOptions {
  /** Injectable id factory -- pinned in tests so assertions can name ids instead of matching them. */
  newId?: () => string;
}

export interface InMemoryTemplateRepository extends TemplateRepository {
  /** Test helper: inspect "storage" without going through a use case. Reads a clone, like everything. */
  snapshot(): TaskTemplateRecord[];
}

function clone(row: TaskTemplateRecord): TaskTemplateRecord {
  return { ...row };
}

export function createInMemoryTemplateRepository(
  options: InMemoryTemplateRepositoryOptions = {},
): InMemoryTemplateRepository {
  const rows = new Map<string, TaskTemplateRecord>();
  const newId = options.newId ?? (() => randomUUID());

  return {
    async create(input: CreateTemplateInput): Promise<TaskTemplateRecord> {
      const row: TaskTemplateRecord = {
        id: newId(),
        ...input,
        // `status` is deliberately NOT part of the create payload: a template is born `active`.
        // B7 (pause / resume) covers everything that happens afterwards, and letting a caller create
        // an already-paused template would be a second way to spell the same state.
        status: 'active',
      };
      rows.set(row.id, row);
      return clone(row);
    },

    async findById(id: string): Promise<TaskTemplateRecord | null> {
      const row = rows.get(id);
      return row === undefined ? null : clone(row);
    },

    async listByFamily(familyId: string): Promise<TaskTemplateRecord[]> {
      // Oldest first: the family task list is a schedule, and a stable insertion order reads better
      // than whatever a Map happens to iterate in after deletes. Ties keep insertion order.
      return [...rows.values()]
        .filter((row) => row.familyId === familyId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(clone);
    },

    async setStatus(
      id: string,
      familyId: string,
      status: TemplateStatus,
    ): Promise<TaskTemplateRecord | null> {
      const row = rows.get(id);
      // Scoped by family: a valid id from another family must look exactly like an unknown id.
      if (row === undefined || row.familyId !== familyId) return null;
      row.status = status;
      return clone(row);
    },

    snapshot(): TaskTemplateRecord[] {
      return [...rows.values()].map(clone);
    },
  };
}
