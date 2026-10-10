/**
 * The one place the frontend talks to the backend.
 *
 * Every method here maps 1:1 to a row in docs/CONTRACTS.md. When a lane lands its endpoint,
 * you delete the corresponding mock branch -- you do NOT add a new call site elsewhere.
 */
import { apiUrl, STORAGE_KEYS, USE_MOCK } from './config';
import * as mock from './mock';
import type { AuthResult, ErrorBody, FamilyResult, MeResult } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: ErrorBody,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class UnauthorizedError extends ApiError {
  constructor(body?: ErrorBody) {
    super('登录已过期,请重新登录', 401, body);
    this.name = 'UnauthorizedError';
  }
}

// ---------------------------------------------------------------- token storage

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.token);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(STORAGE_KEYS.token, token);
    else window.localStorage.removeItem(STORAGE_KEYS.token);
  } catch {
    /* private mode: keep going without persistence */
  }
}

// ---------------------------------------------------------------- http core

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
}

/** Called when the backend answers 401: the app clears its session and returns to login. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(apiUrl(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401) {
    setToken(null);
    onUnauthorized?.();
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    let parsed: ErrorBody | undefined;
    try {
      parsed = (await response.json()) as ErrorBody;
    } catch {
      /* non-json error body */
    }
    throw new ApiError(parsed?.error ?? `请求失败(${response.status})`, response.status, parsed);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Small delay so the mock behaves like a network call (loading states stay honest). */
const wait = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- endpoints (CONTRACTS #3-#10)

export const api = {
  /** CONTRACTS #3 */
  async register(input: { account: string; password: string; nickname: string }): Promise<AuthResult> {
    if (USE_MOCK) {
      await wait();
      return mock.register(input);
    }
    return request<AuthResult>('/api/auth/register', { method: 'POST', body: input, auth: false });
  },

  /** CONTRACTS #4 */
  async login(input: { account: string; password: string }): Promise<AuthResult> {
    if (USE_MOCK) {
      await wait();
      return mock.login(input);
    }
    return request<AuthResult>('/api/auth/login', { method: 'POST', body: input, auth: false });
  },

  /** CONTRACTS #5 */
  async me(): Promise<MeResult> {
    if (USE_MOCK) {
      await wait();
      return mock.me();
    }
    return request<MeResult>('/api/auth/me');
  },

  /** CONTRACTS #6 */
  async createFamily(input: { name: string; timezone?: string }): Promise<FamilyResult> {
    if (USE_MOCK) {
      await wait();
      return mock.createFamily(input);
    }
    return request<FamilyResult>('/api/families', { method: 'POST', body: input });
  },

  /** CONTRACTS #7 */
  async joinFamily(input: { inviteCode: string; nickname?: string }): Promise<FamilyResult> {
    if (USE_MOCK) {
      await wait();
      return mock.joinFamily(input);
    }
    return request<FamilyResult>('/api/families/join', { method: 'POST', body: input });
  },

  /** CONTRACTS #8 */
  async listFamilies(): Promise<{ families: FamilySummaryList }> {
    if (USE_MOCK) {
      await wait();
      return mock.listFamilies();
    }
    return request<{ families: FamilySummaryList }>('/api/families');
  },

  /** CONTRACTS #9 */
  async members(familyId: string): Promise<{ members: import('./types').MemberSummary[] }> {
    if (USE_MOCK) {
      await wait();
      return mock.members(familyId);
    }
    return request<{ members: import('./types').MemberSummary[] }>(
      `/api/families/${encodeURIComponent(familyId)}/members`,
    );
  },
};

type FamilySummaryList = import('./types').FamilySummary[];
