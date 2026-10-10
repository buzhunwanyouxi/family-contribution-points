/**
 * Environment switches.
 *
 * `VITE_USE_MOCK=true` (the default in development) lets the whole UI run without a backend:
 * every call in `api/client.ts` answers from `api/mock.ts`. When lanes A and B land their real
 * endpoints, flip it to `false` and nothing else in the app changes.
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
