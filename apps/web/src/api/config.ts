/**
 * Environment switches.
 *
 * `VITE_USE_MOCK=false` points every call in `api/client.ts` at the real backend; anything else
 * (including unset) uses `api/mock.ts`, which is the development default so the UI can run with no
 * database.
 *
 * ⚠️ **Mock mode cannot catch authentication bugs.** `api/mock.ts` never inspects a token, so a
 * missing `Authorization` header looks perfectly healthy there. One such bug shipped on 2026-10-13:
 * the token was never persisted after login/register, so every authenticated call answered 401 and
 * bounced the user back to the login screen -- invisible in mock mode, fatal against the real API.
 * Before calling a feature done, run it once with `VITE_USE_MOCK=false` against `apps/api`.
 */
export const USE_MOCK: boolean = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false';

/** Empty means "same origin", which is how it runs in production (behind the same domain). */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';

/** Turn contract paths into callable URLs. */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export const STORAGE_KEYS = {
  token: 'fcp.token',
} as const;
