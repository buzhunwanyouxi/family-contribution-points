import { describe, expect, it } from 'vitest';
import { AuthError } from './errors.js';
import { createPrismaAuthRepository } from './repository.prisma.js';
import type { PrismaLikeClient, PrismaUserDelegate, PrismaUserRow } from './repository.prisma.js';
import { createAuthService } from './service.js';

/**
 * A tiny stand-in for `PrismaClient` -- enough to prove the adapter maps rows and constraint
 * violations correctly WITHOUT needing a database, which is exactly what a day-1 PR should do.
 */
function fakePrisma(): { client: PrismaLikeClient; rows: Map<string, PrismaUserRow> } {
  const rows = new Map<string, PrismaUserRow>();
  const idByPhone = new Map<string, string>();
  const idByEmail = new Map<string, string>();
  let sequence = 0;

  const user: PrismaUserDelegate = {
    async findUnique({ where }): Promise<PrismaUserRow | null> {
      const key = where as { id?: unknown; phone?: unknown; email?: unknown };
      if (typeof key.id === 'string') return rows.get(key.id) ?? null;
      if (typeof key.phone === 'string') {
        const id = idByPhone.get(key.phone);
        return id === undefined ? null : (rows.get(id) ?? null);
      }
      if (typeof key.email === 'string') {
        const id = idByEmail.get(key.email);
        return id === undefined ? null : (rows.get(id) ?? null);
      }
      return null;
    },

    async create({ data }): Promise<PrismaUserRow> {
      const phone = (data.phone ?? null) as string | null;
      const email = (data.email ?? null) as string | null;
      if (phone !== null && idByPhone.has(phone)) {
        throw Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['phone'] } });
      }
      if (email !== null && idByEmail.has(email)) {
        throw Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['email'] } });
      }
      sequence += 1;
      const row: PrismaUserRow = {
        id: `cuid_${sequence}`,
        phone,
        email,
        nickname: String(data.nickname),
        avatarUrl: null,
        pwdHash: String(data.pwdHash),
        createdAt: new Date('2026-10-11T09:00:00.000Z'),
      };
      rows.set(row.id, row);
      if (phone !== null) idByPhone.set(phone, row.id);
      if (email !== null) idByEmail.set(email, row.id);
      return row;
    },
  };

  return { client: { user }, rows };
}

describe('createPrismaAuthRepository', () => {
  it('reads rows back by id, phone and email', async () => {
    const prisma = fakePrisma();
    const repository = createPrismaAuthRepository(prisma.client);

    const created = await repository.create({
      phone: '13800138000',
      email: 'dad@example.com',
      nickname: '爸爸',
      pwdHash: 'scrypt$fake',
    });

    expect(await repository.findById(created.id)).toMatchObject({ nickname: '爸爸' });
    expect(await repository.findByPhone('13800138000')).toMatchObject({ id: created.id });
    expect(await repository.findByEmail('dad@example.com')).toMatchObject({ id: created.id });
    expect(await repository.findById('does-not-exist')).toBeNull();
    expect(await repository.findByPhone('13900139000')).toBeNull();
  });

  it('lower-cases the email lookup so the unique index behaves case-insensitively', async () => {
    const prisma = fakePrisma();
    const repository = createPrismaAuthRepository(prisma.client);
    await repository.create({
      phone: null,
      email: 'dad@example.com',
      nickname: '爸爸',
      pwdHash: 'scrypt$fake',
    });

    expect(await repository.findByEmail('DAD@Example.COM')).toMatchObject({
      email: 'dad@example.com',
    });
  });

  it('translates a Prisma P2002 violation into AuthError.user_exists (409)', async () => {
    const prisma = fakePrisma();
    const repository = createPrismaAuthRepository(prisma.client);
    const input = { phone: '13800138000', email: null, nickname: '爸爸', pwdHash: 'scrypt$fake' };
    await repository.create(input);

    const error = await repository.create(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).code).toBe('user_exists');
    expect((error as AuthError).status).toBe(409);
    expect((error as AuthError).logReason).toBe('duplicate_phone');
  });

  it('reports the email column when that is the violated index', async () => {
    const prisma = fakePrisma();
    const repository = createPrismaAuthRepository(prisma.client);
    const input = { phone: null, email: 'dad@example.com', nickname: '爸爸', pwdHash: 'scrypt$fake' };
    await repository.create(input);

    const error = await repository.create(input).catch((e: unknown) => e);
    expect((error as AuthError).logReason).toBe('duplicate_email');
  });

  it('lets unrelated database errors through untouched', async () => {
    const client: PrismaLikeClient = {
      user: {
        findUnique: async () => null,
        create: async () => {
          throw new Error('connection lost');
        },
      },
    };
    await expect(
      createPrismaAuthRepository(client).create({
        phone: '13800138000',
        email: null,
        nickname: '爸爸',
        pwdHash: 'scrypt$fake',
      }),
    ).rejects.toThrow('connection lost');
  });
});

describe('auth module wired to a database-shaped client (end to end, no DB)', () => {
  it('registers into the client and logs the same account back out of it', async () => {
    const prisma = fakePrisma();
    const service = createAuthService({
      repository: createPrismaAuthRepository(prisma.client),
      secret: 'test-secret',
      ttlSeconds: 3600,
    });

    const registered = await service.register({
      account: '13800138000',
      nickname: '弟弟',
      password: 'a-good-password',
    });
    expect(prisma.rows.size).toBe(1);
    expect(registered.user.id).toBe('cuid_1');
    expect(registered.families).toEqual([]);
    expect(Object.keys(registered).sort()).toEqual(['families', 'token', 'user']);

    const loggedIn = await service.login({ account: '13800138000', password: 'a-good-password' });
    expect(loggedIn.user.id).toBe(registered.user.id);

    const me = await service.me(registered.user.id);
    expect(me.user.nickname).toBe('弟弟');
    expect(me.families).toEqual([]);

    const duplicate = await service
      .register({ account: '13800138000', nickname: '冒名', password: 'a-good-password' })
      .catch((e: unknown) => e);
    expect((duplicate as AuthError).code).toBe('user_exists');
  });

  it('stores an email account in the email column and leaves phone null', async () => {
    const prisma = fakePrisma();
    const service = createAuthService({
      repository: createPrismaAuthRepository(prisma.client),
      secret: 'test-secret',
    });

    const registered = await service.register({
      account: 'Dad@Example.COM',
      nickname: '爸爸',
      password: 'a-good-password',
    });

    const row = prisma.rows.get(registered.user.id);
    expect(row?.email).toBe('dad@example.com');
    expect(row?.phone).toBeNull();
    expect(registered.user).not.toHaveProperty('phone');
  });
});
