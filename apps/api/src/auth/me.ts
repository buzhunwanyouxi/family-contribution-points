/**
 * `GET /api/auth/me` use-case (CONTRACTS #5).
 *
 * Frozen shape: `{user, families}`. The path lives under `/api/auth/` -- the frontend calls
 * `GET /api/auth/me` (see `apps/web/src/app/session.tsx`), and a 401 here is what sends the app
 * back to the login screen.
 */
import { AuthError } from './errors.js';
import { listFamiliesFor } from './families.js';
import { toUserSummary } from './mapper.js';
import type { AuthUseCaseDeps, MeResult } from './types.js';

export async function getMe(deps: AuthUseCaseDeps, userId: string): Promise<MeResult> {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw AuthError.unauthorized('missing_user_context');
  }

  const record = await deps.repository.findById(userId);
  if (record === null) {
    // Valid signature, but the account is gone: 401 so the client drops its token and re-logs in.
    throw AuthError.unauthorized('user_not_found');
  }

  return {
    user: toUserSummary(record),
    families: await listFamiliesFor(deps, record.id),
  };
}
