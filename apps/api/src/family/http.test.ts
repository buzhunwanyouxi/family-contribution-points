/**
 * End-to-end HTTP tests for CONTRACTS #6-#9, through a real Fastify instance (`inject`).
 *
 * These are deliberately **cross-module**: the app is assembled exactly the way
 * `apps/api/src/routes/index.ts` assembles it -- lane A's `registerAuth` first, then lane B's
 * `registerFamily` -- and tokens come from really registering an account through
 * `POST /api/auth/register`. Nothing about authentication is faked any more, because lane A has
 * landed on `main`; see this round's ops log (W1-B2) for why the earlier bridge is gone.
 *
 * That also makes the hand-over testable: if `familyDirectory` were not wired, the `families`
 * array on `/api/auth/me` would silently stay empty, and one of the tests below would fail.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createInMemoryAuthRepository } from '../auth/index.js';
import { registerAuth } from '../routes/auth.js';
import { registerFamily } from '../routes/family.js';
import { createFamilyDirectory } from './directory.js';
import { createInMemoryFamilyRepository } from './repository.js';
import type { InMemoryFamilyRepository } from './repository.js';
import { createFamilyService } from './service.js';
import type { FamilyService } from './service.js';

const SECRET = 'family-http-test-secret';
const T0 = new Date('2026-03-01T10:00:00.000Z');
const PASSWORD = 'a-good-password';

interface SignedUp {
  token: string;
  user: { id: string; nickname: string };
  auth: { authorization: string };
}

interface Harness {
  app: FastifyInstance;
  repository: InMemoryFamilyRepository;
  service: FamilyService;
  time: { now: Date };
  /** Registers a real account through lane A and returns its token. */
  signUp: (account: string, nickname: string) => Promise<SignedUp>;
}

const open: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((app) => app.close()));
});

/** Deterministic but varying, so several families can be created inside one test. */
function countingRandom() {
  let draws = 0;
  return () => {
    const block = Math.floor(draws / 6);
    draws += 1;
    return (block % 32) / 32;
  };
}

async function harness(): Promise<Harness> {
  const time = { now: T0 };
  const repository = createInMemoryFamilyRepository({
    newId: (() => {
      let counter = 0;
      return () => `fam-id-${(counter += 1)}`;
    })(),
  });
  const service = createFamilyService({
    repository,
    clock: () => time.now,
    random: countingRandom(),
    env: {},
  });

  const app = Fastify();
  // Same order and same wiring as apps/api/src/routes/index.ts.
  await registerAuth(app, {
    repository: createInMemoryAuthRepository(),
    secret: SECRET,
    familyDirectory: createFamilyDirectory(service),
  });
  await registerFamily(app, { service });
  await app.ready();
  open.push(app);

  const signUp = async (account: string, nickname: string): Promise<SignedUp> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { account, password: PASSWORD, nickname },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    // The two in-memory repositories are separate stores -- production shares one database, so
    // this only exists to make the account visible to the family repository as well.
    repository.seedUser({ id: body.user.id, nickname: body.user.nickname });
    return {
      token: body.token,
      user: body.user,
      auth: { authorization: `Bearer ${body.token}` },
    };
  };

  return { app, repository, service, time, signUp };
}

describe('authentication is lane A\'s, and these routes are really behind it', () => {
  it('answers 401 for a missing token', async () => {
    const { app } = await harness();
    const response = await app.inject({ method: 'GET', url: '/api/families' });

    expect(response.statusCode).toBe(401);
    expect(typeof response.json().message).toBe('string');
  });

  it('answers 401 for a forged token instead of trusting it', async () => {
    const { app } = await harness();
    const response = await app.inject({
      method: 'GET',
      url: '/api/families',
      headers: { authorization: 'Bearer not.a.real.jwt' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('refuses to mount at all when lane A has not decorated app.requireAuth', async () => {
    // A startup failure is the point: Fastify treats an `undefined` preHandler as "no hook", so
    // mounting family first would publish /api/families/** to the world.
    const app = Fastify();
    await expect(registerFamily(app)).rejects.toThrow(/registerAuth/);
    await app.close();
  });
});

describe('POST /api/families - CONTRACTS #6', () => {
  it('creates the family and answers 201 with the frozen shape', async () => {
    const { app, repository, signUp } = await harness();
    const dad = await signUp('dad@example.com', '爸爸');

    const response = await app.inject({
      method: 'POST',
      url: '/api/families',
      headers: dad.auth,
      payload: { name: '我们家' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(Object.keys(body).sort()).toEqual(['family', 'membership']);
    expect(Object.keys(body.family).sort()).toEqual([
      'earnedPoints',
      'frozenPoints',
      'id',
      'name',
      'points',
      'role',
      'spentPoints',
    ]);
    expect(Object.keys(body.membership).sort()).toEqual(['id', 'joinedAt', 'role']);
    expect(body.family.name).toBe('我们家');
    expect(body.family.role).toBe('owner');
    expect(repository.snapshot().families).toHaveLength(1);
  });

  it('returns all four points numbers as zero, never omitting one', async () => {
    const { app, signUp } = await harness();
    const dad = await signUp('dad@example.com', '爸爸');

    const response = await app.inject({
      method: 'POST',
      url: '/api/families',
      headers: dad.auth,
      payload: { name: '我们家' },
    });

    expect(response.json().family).toMatchObject({
      points: 0,
      earnedPoints: 0,
      spentPoints: 0,
      frozenPoints: 0,
    });
  });

  it('rejects a name that breaks the rule with 400 and a displayable message', async () => {
    const { app, signUp } = await harness();
    const dad = await signUp('dad@example.com', '爸爸');

    const response = await app.inject({
      method: 'POST',
      url: '/api/families',
      headers: dad.auth,
      payload: { name: '家'.repeat(21) },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe('validation_error');
    expect(typeof body.message).toBe('string');
    expect(body.message).not.toBe('validation_error');
  });

  it('rejects a missing body with 400 rather than a 500', async () => {
    const { app, signUp } = await harness();
    const dad = await signUp('dad@example.com', '爸爸');

    const response = await app.inject({
      method: 'POST',
      url: '/api/families',
      headers: dad.auth,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('validation_error');
  });

  it('ignores unknown body fields instead of rejecting the request', async () => {
    const { app, signUp } = await harness();
    const dad = await signUp('dad@example.com', '爸爸');

    const response = await app.inject({
      method: 'POST',
      url: '/api/families',
      headers: dad.auth,
      payload: { name: '我们家', ownerId: 'someone-else' },
    });

    expect(response.statusCode).toBe(201);
    // The creator still owns it -- a client cannot smuggle an owner in through the body.
    expect(response.json().family.role).toBe('owner');
  });
});

describe('POST /api/families/join - CONTRACTS #7', () => {
  it('joins a second account as a member and answers 200', async () => {
    const { app, repository, service, signUp } = await harness();
    const dad = await signUp('dad@example.com', '爸爸');
    const mom = await signUp('mom@example.com', '妈妈');
    const created = await service.createFamily(dad.user.id, { name: '我们家' });
    const code = repository.snapshot().families[0]?.inviteCode ?? '';

    const response = await app.inject({
      method: 'POST',
      url: '/api/families/join',
      headers: mom.auth,
      payload: { inviteCode: code },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().family.id).toBe(created.family.id);
    expect(response.json().family.role).toBe('member');
  });

  it('is idempotent: joining twice answers 200 both times with the same membership', async () => {
    const { app, repository, service, signUp } = await harness();
    const dad = await signUp('dad@example.com', '爸爸');
    const mom = await signUp('mom@example.com', '妈妈');
    await service.createFamily(dad.user.id, { name: '我们家' });
    const code = repository.snapshot().families[0]?.inviteCode ?? '';

    const first = await app.inject({
      method: 'POST',
      url: '/api/families/join',
      headers: mom.auth,
      payload: { inviteCode: code },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/families/join',
      headers: mom.auth,
      payload: { inviteCode: code },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().membership.id).toBe(first.json().membership.id);
    expect(repository.snapshot().memberships).toHaveLength(2);
  });

  it('maps an unknown code to 404 invalid_invite_code with Chinese copy', async () => {
    const { app, signUp } = await harness();
    const mom = await signUp('mom@example.com', '妈妈');

    const response = await app.inject({
      method: 'POST',
      url: '/api/families/join',
      headers: mom.auth,
      payload: { inviteCode: 'ZZZZZZ' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('invalid_invite_code');
    expect(response.json().message).toMatch(/邀请码/);
  });

  it('maps an expired code to 400 invite_expired', async () => {
    const { app, repository, service, time, signUp } = await harness();
    const dad = await signUp('dad@example.com', '爸爸');
    await service.createFamily(dad.user.id, { name: '我们家' });
    const code = repository.snapshot().families[0]?.inviteCode ?? '';

    // 19 days on: the 7-day invite is long dead, and no sleeping is involved.
    time.now = new Date('2026-03-20T10:00:00.000Z');

    const response = await app.inject({
      method: 'POST',
      url: '/api/families/join',
      headers: dad.auth,
      payload: { inviteCode: code },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invite_expired');
    expect(response.json().message).toMatch(/过期/);
  });
});

describe('GET /api/families - CONTRACTS #8', () => {
  it('returns an empty array for a fresh account', async () => {
    const { app, signUp } = await harness();
    const dad = await signUp('dad@example.com', '爸爸');

    const response = await app.inject({ method: 'GET', url: '/api/families', headers: dad.auth });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ families: [] });
  });

  it('carries the four points numbers through to the wire unchanged', async () => {
    const { app, repository, service, signUp } = await harness();
    const dad = await signUp('dad@example.com', '爸爸');
    const created = await service.createFamily(dad.user.id, { name: '我们家' });
    repository.setPointsForTest(dad.user.id, created.family.id, {
      points: 42.4,
      earnedPoints: 86.4,
      spentPoints: 44,
      frozenPoints: 5,
    });

    const response = await app.inject({ method: 'GET', url: '/api/families', headers: dad.auth });
    expect(response.json().families[0]).toMatchObject({
      points: 42.4,
      earnedPoints: 86.4,
      spentPoints: 44,
      frozenPoints: 5,
    });
    // F6 v1.3: earned - spent === available. This module only carries the identity, it never
    // recomputes it -- if that ever changes, this assertion is the tripwire.
    const [family] = response.json().families;
    expect(family.earnedPoints - family.spentPoints).toBeCloseTo(family.points, 10);
  });
});

describe('GET /api/families/:fid/members - CONTRACTS #9', () => {
  it('lists members for a member of the family', async () => {
    const { app, service, signUp } = await harness();
    const dad = await signUp('dad@example.com', '爸爸');
    const created = await service.createFamily(dad.user.id, { name: '我们家' });

    const response = await app.inject({
      method: 'GET',
      url: `/api/families/${created.family.id}/members`,
      headers: dad.auth,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().members).toHaveLength(1);
    expect(Object.keys(response.json().members[0]).sort()).toEqual([
      'joinedAt',
      'nickname',
      'role',
      'userId',
    ]);
  });

  it('refuses a caller from another family with 403', async () => {
    const { app, service, signUp } = await harness();
    const dad = await signUp('dad@example.com', '爸爸');
    const stranger = await signUp('stranger@example.com', '路人');
    const created = await service.createFamily(dad.user.id, { name: '我们家' });

    const response = await app.inject({
      method: 'GET',
      url: `/api/families/${created.family.id}/members`,
      headers: stranger.auth,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('not_a_member');
  });

  it('answers 403 for an unknown family id too, so ids cannot be probed', async () => {
    const { app, signUp } = await harness();
    const dad = await signUp('dad@example.com', '爸爸');

    const response = await app.inject({
      method: 'GET',
      url: '/api/families/does-not-exist/members',
      headers: dad.auth,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('not_a_member');
  });
});

describe('lane A <- lane B hand-over: the `families` array', () => {
  it('registers with an empty array, never an error (CONTRACTS rule 5)', async () => {
    const { app } = await harness();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { account: 'solo@example.com', password: PASSWORD, nickname: '独居' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().families).toEqual([]);
  });

  it('makes /api/auth/me carry the family once one exists', async () => {
    const { app, service, signUp } = await harness();
    const dad = await signUp('dad@example.com', '爸爸');
    const created = await service.createFamily(dad.user.id, { name: '我们家' });

    const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers: dad.auth });

    expect(response.statusCode).toBe(200);
    expect(response.json().families).toHaveLength(1);
    expect(response.json().families[0]).toMatchObject({
      id: created.family.id,
      name: '我们家',
      role: 'owner',
      points: 0,
      earnedPoints: 0,
      spentPoints: 0,
      frozenPoints: 0,
    });
  });

  it('keeps the four numbers out of lane A hands: they are forwarded, not recomputed', async () => {
    const { app, repository, service, signUp } = await harness();
    const dad = await signUp('dad@example.com', '爸爸');
    const created = await service.createFamily(dad.user.id, { name: '我们家' });
    repository.setPointsForTest(dad.user.id, created.family.id, {
      points: 42.4,
      earnedPoints: 86.4,
      spentPoints: 44,
      frozenPoints: 5,
    });

    const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers: dad.auth });
    expect(response.json().families[0]).toMatchObject({
      points: 42.4,
      earnedPoints: 86.4,
      spentPoints: 44,
      frozenPoints: 5,
    });
  });
});

describe('error envelope - CONTRACTS section 2 rule 4', () => {
  it('always sends {error, message} so the UI never shows a machine code', async () => {
    const { app, signUp } = await harness();
    const dad = await signUp('dad@example.com', '爸爸');

    const response = await app.inject({
      method: 'POST',
      url: '/api/families/join',
      headers: dad.auth,
      payload: { inviteCode: 'AAAAAA' },
    });

    const body = response.json();
    expect(typeof body.error).toBe('string');
    expect(typeof body.message).toBe('string');
    expect(body.message).not.toBe(body.error);
  });
});
