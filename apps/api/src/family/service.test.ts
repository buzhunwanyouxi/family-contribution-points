import { describe, expect, it } from 'vitest';
import { FamilyError } from './errors.js';
import { createInMemoryFamilyRepository } from './repository.js';
import type { InMemoryFamilyRepository } from './repository.js';
import { FAMILY_NAME_MAX_LENGTH, createFamilyService, toFamilySummary } from './service.js';
import type { FamilyService } from './service.js';
import { createFamilyDirectory } from './directory.js';
import type { MembershipWithFamily } from './types.js';

const T0 = new Date('2026-03-01T10:00:00.000Z');

/** A clock the test can move, so expiry can be crossed without waiting. */
function movableClock(start: Date) {
  const state = { now: start };
  return {
    clock: () => state.now,
    advanceDays: (days: number) => {
      state.now = new Date(state.now.getTime() + days * 24 * 60 * 60 * 1000);
    },
    set: (date: Date) => {
      state.now = date;
    },
  };
}

/**
 * Deterministic but *varying* random source: the first generated code is '222222', the second
 * '333333', and so on. A constant source would make the second `createFamily` in a test collide
 * forever, which is a property of the test double and not of the code under test.
 */
function countingRandom() {
  let draws = 0;
  return () => {
    const block = Math.floor(draws / 6);
    draws += 1;
    return (block % 32) / 32;
  };
}

function setup() {
  const time = movableClock(T0);
  const repository = createInMemoryFamilyRepository({
    users: [
      { id: 'dad', nickname: '爸爸' },
      { id: 'mom', nickname: '妈妈' },
      { id: 'kid', nickname: '小明', avatarUrl: null },
    ],
    newId: (() => {
      let counter = 0;
      return () => `id-${(counter += 1)}`;
    })(),
  });
  const service = createFamilyService({
    repository,
    clock: time.clock,
    random: countingRandom(),
    env: {},
  });
  return { repository, service, time };
}

async function newFamily(service: FamilyService, ownerId = 'dad', name = '我们家') {
  return service.createFamily(ownerId, { name });
}

describe('createFamily - CONTRACTS #6 / W1-03', () => {
  it('makes the creator the owner', async () => {
    const { service } = setup();
    const result = await newFamily(service);

    expect(result.family.role).toBe('owner');
    expect(result.membership.role).toBe('owner');
    expect(result.membership.id).toBeTruthy();
  });

  it('starts every member at zero on all four numbers', async () => {
    const { service } = setup();
    const { family } = await newFamily(service);

    expect(family.points).toBe(0);
    expect(family.earnedPoints).toBe(0);
    expect(family.spentPoints).toBe(0);
    expect(family.frozenPoints).toBe(0);
  });

  it('writes the invite code and its expiry onto the Family row', async () => {
    const { service, repository } = setup();
    await newFamily(service);

    const [family] = repository.snapshot().families;
    expect(family?.inviteCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(family?.inviteExpireAt?.toISOString()).toBe('2026-03-08T10:00:00.000Z');
  });

  it('trims the family name and defaults the timezone', async () => {
    const { service, repository } = setup();
    await service.createFamily('dad', { name: '  我们家  ' });

    const [family] = repository.snapshot().families;
    expect(family?.name).toBe('我们家');
    expect(family?.timezone).toBe('Asia/Shanghai');
  });

  it('accepts a valid IANA timezone', async () => {
    const { service, repository } = setup();
    await service.createFamily('dad', { name: '我们家', timezone: 'Europe/London' });

    expect(repository.snapshot().families[0]?.timezone).toBe('Europe/London');
  });

  it('rejects an unknown timezone rather than storing it', async () => {
    const { service } = setup();
    await expect(
      service.createFamily('dad', { name: '我们家', timezone: 'Mars/Olympus' }),
    ).rejects.toMatchObject({ code: 'validation_error', status: 400 });
  });

  it('rejects an empty name', async () => {
    const { service } = setup();
    await expect(service.createFamily('dad', { name: '   ' })).rejects.toBeInstanceOf(FamilyError);
    await expect(service.createFamily('dad', { name: '' })).rejects.toMatchObject({
      code: 'validation_error',
    });
  });

  it(`rejects a name longer than ${FAMILY_NAME_MAX_LENGTH} characters`, async () => {
    const { service } = setup();
    const tooLong = '家'.repeat(FAMILY_NAME_MAX_LENGTH + 1);
    await expect(service.createFamily('dad', { name: tooLong })).rejects.toMatchObject({
      code: 'validation_error',
      status: 400,
    });
  });

  it('counts characters, not UTF-16 units, for the length rule', async () => {
    const { service } = setup();
    // 20 astral-plane emoji are 40 UTF-16 units: a `.length` check would wrongly reject this.
    const name = '🏠'.repeat(FAMILY_NAME_MAX_LENGTH);
    await expect(service.createFamily('dad', { name })).resolves.toBeDefined();
  });

  it('issues a distinct invite code for each new family', async () => {
    const { service, repository } = setup();

    const first = await newFamily(service, 'dad', '家 A');
    const second = await newFamily(service, 'mom', '家 B');

    const codes = repository.snapshot().families.map((f) => f.inviteCode);
    expect(codes).toEqual(['222222', '333333']);
    expect(first.family.id).not.toBe(second.family.id);
  });
});

describe('joinFamily - CONTRACTS #7 / W1-04', () => {
  it('adds the joiner as a plain member', async () => {
    const { service, repository } = setup();
    const created = await newFamily(service);
    const code = repository.snapshot().families[0]?.inviteCode ?? '';

    const joined = await service.joinFamily('mom', { inviteCode: code });
    expect(joined.family.id).toBe(created.family.id);
    expect(joined.family.role).toBe('member');
    expect(joined.membership.role).toBe('member');
  });

  it('accepts a code the user typed in lower case with separators', async () => {
    const { service, repository } = setup();
    await newFamily(service);
    const code = repository.snapshot().families[0]?.inviteCode ?? '';
    const messy = code.toLowerCase().split('').join('-');

    await expect(service.joinFamily('mom', { inviteCode: messy })).resolves.toBeDefined();
  });

  it('rejects a code that does not exist', async () => {
    const { service } = setup();
    await newFamily(service);
    await expect(service.joinFamily('mom', { inviteCode: 'ZZZZZZ' })).rejects.toMatchObject({
      code: 'invalid_invite_code',
      status: 404,
    });
  });

  it('answers malformed codes the same way as unknown ones (no probing)', async () => {
    const { service } = setup();
    for (const bad of ['', 'ABC', 'ABCDEFG', 'ABCDE1', 'abcdef']) {
      await expect(service.joinFamily('mom', { inviteCode: bad })).rejects.toMatchObject({
        code: 'invalid_invite_code',
      });
    }
  });

  it('rejects an expired code', async () => {
    const { service, repository, time } = setup();
    await newFamily(service);
    const code = repository.snapshot().families[0]?.inviteCode ?? '';

    time.advanceDays(8);
    await expect(service.joinFamily('mom', { inviteCode: code })).rejects.toMatchObject({
      code: 'invite_expired',
      status: 400,
    });
  });

  it('still accepts a code one day before it expires', async () => {
    const { service, repository, time } = setup();
    await newFamily(service);
    const code = repository.snapshot().families[0]?.inviteCode ?? '';

    time.advanceDays(6);
    await expect(service.joinFamily('mom', { inviteCode: code })).resolves.toBeDefined();
  });

  it('is idempotent: joining twice returns the same membership and adds no row', async () => {
    const { service, repository } = setup();
    await newFamily(service);
    const code = repository.snapshot().families[0]?.inviteCode ?? '';

    const first = await service.joinFamily('mom', { inviteCode: code });
    const second = await service.joinFamily('mom', { inviteCode: code });

    expect(second.membership.id).toBe(first.membership.id);
    expect(repository.snapshot().memberships).toHaveLength(2); // owner + mom, not three
  });

  it('lets the owner re-join their own family without losing the owner role', async () => {
    const { service, repository } = setup();
    await newFamily(service);
    const code = repository.snapshot().families[0]?.inviteCode ?? '';

    const again = await service.joinFamily('dad', { inviteCode: code });
    expect(again.family.role).toBe('owner');
  });

  it('honours the optional nickname by renaming the account', async () => {
    const { service, repository } = setup();
    await newFamily(service);
    const code = repository.snapshot().families[0]?.inviteCode ?? '';

    await service.joinFamily('mom', { inviteCode: code, nickname: '老妈' });
    const members = await service.listMembers('dad', (await service.listFamilies('dad'))[0]!.id);
    expect(members.find((m) => m.userId === 'mom')?.nickname).toBe('老妈');
  });

  it('leaves the nickname alone when the field is absent', async () => {
    const { service, repository } = setup();
    await newFamily(service);
    const code = repository.snapshot().families[0]?.inviteCode ?? '';

    await service.joinFamily('mom', { inviteCode: code });
    const familyId = (await service.listFamilies('dad'))[0]!.id;
    const members = await service.listMembers('dad', familyId);
    expect(members.find((m) => m.userId === 'mom')?.nickname).toBe('妈妈');
  });

  it('rejects a blank nickname instead of storing an empty name', async () => {
    const { service, repository } = setup();
    await newFamily(service);
    const code = repository.snapshot().families[0]?.inviteCode ?? '';

    await expect(
      service.joinFamily('mom', { inviteCode: code, nickname: '   ' }),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });
});

describe('listFamilies - CONTRACTS #8 / W1-06', () => {
  it('returns an empty array for an account in no family, never an error', async () => {
    const { service } = setup();
    await expect(service.listFamilies('kid')).resolves.toEqual([]);
  });

  it('returns one summary per family, with the role from that family', async () => {
    const { service, repository } = setup();
    await newFamily(service, 'dad', '家 A');
    const code = repository.snapshot().families[0]?.inviteCode ?? '';
    await service.joinFamily('mom', { inviteCode: code });
    await newFamily(service, 'mom', '家 B');

    const forMom = await service.listFamilies('mom');
    expect(forMom).toHaveLength(2);
    expect(forMom.map((f) => f.name).sort()).toEqual(['家 A', '家 B']);
    expect(forMom.find((f) => f.name === '家 A')?.role).toBe('member');
    expect(forMom.find((f) => f.name === '家 B')?.role).toBe('owner');
  });

  it('forwards the four points numbers verbatim instead of recomputing them', async () => {
    const { service, repository } = setup();
    await newFamily(service);
    const familyId = repository.snapshot().families[0]?.id ?? '';

    // Deliberately "ugly" numbers: any rounding or a second points formula would show up here.
    repository.setPointsForTest('dad', familyId, {
      points: 42.4,
      earnedPoints: 86.4,
      spentPoints: 44,
      frozenPoints: 5,
    });

    const [summary] = await service.listFamilies('dad');
    expect(summary).toMatchObject({
      points: 42.4,
      earnedPoints: 86.4,
      spentPoints: 44,
      frozenPoints: 5,
    });
    // F6 v1.3 identity, as produced by the ledger -- this module only carries it.
    expect(summary!.earnedPoints - summary!.spentPoints).toBeCloseTo(summary!.points, 10);
  });

  it('keeps frozen as a subset of available rather than a second deduction', async () => {
    const { service, repository } = setup();
    await newFamily(service);
    const familyId = repository.snapshot().families[0]?.id ?? '';
    repository.setPointsForTest('dad', familyId, {
      points: 10,
      earnedPoints: 10,
      spentPoints: 0,
      frozenPoints: 8,
    });

    const [summary] = await service.listFamilies('dad');
    expect(summary!.points).toBe(10);
    expect(summary!.points - summary!.frozenPoints).toBe(2);
  });
});

describe('toFamilySummary', () => {
  it('copies every field through without arithmetic', () => {
    const entry: MembershipWithFamily = {
      family: {
        id: 'fam-1',
        name: '我们家',
        ownerId: 'dad',
        inviteCode: '8F3K2Q',
        inviteExpireAt: null,
        timezone: 'Asia/Shanghai',
        createdAt: T0,
      },
      membership: {
        id: 'mem-1',
        userId: 'dad',
        familyId: 'fam-1',
        role: 'owner',
        points: 1.83,
        earnedPoints: 3.66,
        spentPoints: 1.83,
        frozenPoints: 0.5,
        joinedAt: T0,
      },
    };

    expect(toFamilySummary(entry)).toEqual({
      id: 'fam-1',
      name: '我们家',
      role: 'owner',
      points: 1.83,
      earnedPoints: 3.66,
      spentPoints: 1.83,
      frozenPoints: 0.5,
    });
  });

  it('narrows an unexpected role to member rather than emitting garbage', () => {
    const entry = {
      family: { id: 'f', name: 'n', ownerId: 'o', inviteCode: 'c', inviteExpireAt: null, timezone: 't', createdAt: T0 },
      membership: {
        id: 'm', userId: 'u', familyId: 'f', role: 'grandpoobah',
        points: 0, earnedPoints: 0, spentPoints: 0, frozenPoints: 0, joinedAt: T0,
      },
    } as unknown as MembershipWithFamily;

    expect(toFamilySummary(entry).role).toBe('member');
  });
});

describe('listMembers - CONTRACTS #9 / W1-05', () => {
  it('refuses a caller who is not in that family', async () => {
    const { service } = setup();
    const family = await newFamily(service);
    await expect(service.listMembers('kid', family.family.id)).rejects.toMatchObject({
      code: 'not_a_member',
      status: 403,
    });
  });

  it('answers an unknown family id the same way, so ids cannot be probed', async () => {
    const { service } = setup();
    await newFamily(service);
    await expect(service.listMembers('dad', 'no-such-family')).rejects.toMatchObject({
      code: 'not_a_member',
      status: 403,
    });
  });

  it('lists the owner first and then everyone by join order', async () => {
    const { service, repository } = setup();
    await newFamily(service);
    const familyId = repository.snapshot().families[0]?.id ?? '';
    const code = repository.snapshot().families[0]?.inviteCode ?? '';

    await service.joinFamily('mom', { inviteCode: code });
    await service.joinFamily('kid', { inviteCode: code });

    const members = await service.listMembers('dad', familyId);
    expect(members.map((m) => m.userId)).toEqual(['dad', 'mom', 'kid']);
    expect(members[0]?.role).toBe('owner');
    expect(members[1]?.role).toBe('member');
  });

  it('omits avatarUrl when there is none instead of sending null', async () => {
    const { service, repository } = setup();
    await newFamily(service);
    const familyId = repository.snapshot().families[0]?.id ?? '';

    const [owner] = await service.listMembers('dad', familyId);
    expect(owner).not.toHaveProperty('avatarUrl');
    expect(Object.keys(owner!).sort()).toEqual(['joinedAt', 'nickname', 'role', 'userId']);
  });

  it('returns joinedAt as an ISO string', async () => {
    const { service, repository } = setup();
    await newFamily(service);
    const familyId = repository.snapshot().families[0]?.id ?? '';

    const [owner] = await service.listMembers('dad', familyId);
    expect(owner!.joinedAt).toBe(T0.toISOString());
  });
});

describe('createFamilyDirectory - lane A hand-over', () => {
  it('returns [] for an account in no family (CONTRACTS rule 5)', async () => {
    const { service } = setup();
    const directory = createFamilyDirectory(service);
    await expect(directory.listFamilies('kid')).resolves.toEqual([]);
  });

  it('returns the same summaries the route serves, points included', async () => {
    const { service, repository } = setup();
    await newFamily(service);
    const familyId = repository.snapshot().families[0]?.id ?? '';
    repository.setPointsForTest('dad', familyId, { points: 7, earnedPoints: 9, spentPoints: 2 });

    const directory = createFamilyDirectory(service);
    await expect(directory.listFamilies('dad')).resolves.toEqual(await service.listFamilies('dad'));
  });
});
