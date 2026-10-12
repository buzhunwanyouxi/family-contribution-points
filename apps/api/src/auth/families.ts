/**
 * The one place the auth module asks lane B for a user's families.
 *
 * CONTRACTS rule 5: register / login / me **all** return `families`, and "没有家庭时返回空数组,
 * 不要报错". Lane C's mock already behaves that way and the UI renders the family switcher from it.
 *
 * Two properties that matter:
 *   - unwired directory (lane B not landed yet) -> `[]`, never a 500;
 *   - the auth module never *computes* points. Whatever lane B returns is forwarded verbatim --
 *     the single source of truth for the four numbers is `apps/api/src/points/ledger.ts`.
 */
import type { AuthUseCaseDeps, FamilySummary } from './types.js';

export async function listFamiliesFor(
  deps: AuthUseCaseDeps,
  userId: string,
): Promise<FamilySummary[]> {
  if (deps.familyDirectory === undefined) return [];
  return deps.familyDirectory.listFamilies(userId);
}
