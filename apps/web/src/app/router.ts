/**
 * A ~60 line hash router.
 *
 * WHY NOT react-router-dom: the project rule is "no new dependencies without asking" (DAY1-PLAN
 * section 6). A hash router keeps the app installable as a PWA with zero extra packages and no
 * server rewrite rules. TODO(W2): propose react-router-dom in an issue if nested routes are needed.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface Route {
  path: string;
  params: Record<string, string>;
}

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/today';
  const [pathname = '', query = ''] = raw.split('?');
  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const [key = '', value = ''] = pair.split('=');
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return { path: pathname || '/today', params };
}

export function navigate(path: string, params?: Record<string, string>): void {
  const query = params
    ? '?' +
      Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
    : '';
  window.location.hash = `#${path}${query}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash());

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    if (!window.location.hash) window.location.hash = '#/today';
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function useNavigate() {
  return useCallback((path: string, params?: Record<string, string>) => navigate(path, params), []);
}

/** Simple guard helper for pages that need the current family id. */
export function useFamilyId(route: Route): string | null {
  return useMemo(() => route.params.fid ?? null, [route.params.fid]);
}
