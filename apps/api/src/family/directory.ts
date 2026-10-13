/**
 * Lane A's hand-over point: `FamilyDirectoryPort`.
 *
 * `apps/api/src/auth/families.ts` documents this as "the one place the auth module asks lane B for
 * a user's families", and `auth/types.ts` declares it as:
 *
 *   export interface FamilyDirectoryPort {
 *     listFamilies(userId: string): Promise<FamilySummary[]>;
 *   }
 *
 * This module satisfies that interface **structurally** instead of importing it, for the reason
 * spelled out in `types.ts`: lane A's file was still on `feat/auth-register` (PR #1) when this
 * module was written, and importing it would have made lane B un-mergeable on its own.
 *
 * Wiring it, once auth has landed (one line in the server bootstrap):
 *
 *   await registerAuth(app, { familyDirectory: createFamilyDirectory(service) });
 *
 * Two properties lane A relies on, both covered by tests:
 *   - a user in no family gets `[]`, never an error (CONTRACTS "前端调用约定" rule 5);
 *   - the four points numbers are forwarded verbatim -- the auth module must never compute points,
 *     and neither does this adapter.
 */
import type { FamilyService } from './service.js';
import type { FamilySummary } from './types.js';

/** Structurally identical to `apps/api/src/auth/types.ts#FamilyDirectoryPort`. */
export interface FamilyDirectory {
  listFamilies(userId: string): Promise<FamilySummary[]>;
}

export function createFamilyDirectory(service: FamilyService): FamilyDirectory {
  return {
    listFamilies: (userId) => service.listFamilies(userId),
  };
}
