import { beforeEach, describe, expect, it } from 'vitest';
import { AuthError } from './errors.js';
import { DEFAULT_ISSUER, createHs256Codec } from './jwt.js';
import { createInMemoryAuthRepository } from './repository.js';
import type { InMemoryAuthRepository } from './repository.js';
import { normalizeRegistration, registerUser } from './register.js';
import type { AuthUseCaseDeps, FamilyDirectoryPort, RegisterInput } from './types.js';

function deps(
  repository: InMemoryAuthRepository,
  familyDirectory?: FamilyDirectoryPort,
): AuthUseCaseDeps {
  const built: AuthUseCaseDeps = {
    repository,
    tokens: createHs256Codec({
      secret: 'test-secret',
      ttlSeconds: 3600,
      issuer: DEFAULT_ISSUER,
      clockToleranceSeconds: 0,
    }),
    logger: { warn: () => {} },
  };
  if (familyDirectory !== undefined) built.familyDirectory = familyDirectory;
  return built;
}

const validPhone: RegisterInput = {
  account: '13800138000',
  nickname: '弟弟',
  password: 'a-good-password',
};

describe('registerUser (CONTRACTS #3)', () => {
  let repository: InMemoryAuthRepository;

  beforeEach(() => {
    // pin the row timestamp here: `createdAt` comes from the persistence layer, not the use-case
    repository = createInMemoryAuthRepository([], {
      now: () => new Date('2026-10-10T12:00:00.000Z'),
    });
  });

  it('persists the account and returns exactly {token, user, families}', async () => {
    const result = await registerUser(deps(repository), validPhone);

    expect(Object.keys(result).sort()).toEqual(['families', 'token', 'user']);
    expect(result.user).toEqual({
      id: expect.any(String),
      nickname: '弟弟',
      phone: '13800138000',
    });
    expect(result.token.split('.')).toHaveLength(3);
    // a brand-new account belongs to nothing: an empty array, not an error (contract rule 5)
    expect(result.families).toEqual([]);

    const stored = await repository.findByPhone('13800138000');
    expect(stored?.id).toBe(result.user.id);
    expect(stored?.pwdHash).not.toContain('a-good-password');
    expect(stored?.pwdHash.startsWith('scrypt$')).toBe(true);
  });

  it('omits absent optional fields instead of sending null (frozen type is `phone?: string`)', async () => {
    const byPhone = await registerUser(deps(repository), validPhone);
    expect(byPhone.user).not.toHaveProperty('email');
    expect(byPhone.user).not.toHaveProperty('avatarUrl');
    // createdAt is not part of the frozen UserSummary
    expect(byPhone.user).not.toHaveProperty('createdAt');

    const byEmail = await registerUser(deps(repository), {
      account: 'dad@example.com',
      nickname: '爸爸',
      password: 'a-good-password',
    });
    expect(byEmail.user).not.toHaveProperty('phone');
    expect(byEmail.user).toHaveProperty('email', 'dad@example.com');
  });

  it('never returns the password hash', async () => {
    const result = await registerUser(deps(repository), validPhone);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('scrypt$');
    expect(serialised).not.toContain('a-good-password');
  });

  it('decides phone-vs-email from the single `account` field', async () => {
    const result = await registerUser(deps(repository), {
      account: '  Dad@Example.COM ',
      nickname: '爸爸',
      password: 'a-good-password',
    });
    expect(result.user.email).toBe('dad@example.com');
    expect(await repository.findByEmail('dad@example.com')).not.toBeNull();
  });

  it('normalises a phone number typed with a country code and separators', async () => {
    const result = await registerUser(deps(repository), {
      account: '+86 138-0013-8000',
      nickname: '妈妈',
      password: 'a-good-password',
    });
    expect(result.user.phone).toBe('13800138000');
    expect(await repository.findByPhone('13800138000')).not.toBeNull();
  });

  it('rejects a duplicate phone with user_exists (409)', async () => {
    await registerUser(deps(repository), validPhone);
    const error = await registerUser(deps(repository), {
      account: '13800138000',
      nickname: '冒名',
      password: 'another-password',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).code).toBe('user_exists');
    expect((error as AuthError).status).toBe(409);
    expect((error as AuthError).userMessage).toBe('该手机号或邮箱已注册');
    expect(repository.count()).toBe(1);
  });

  it('treats a differently-cased duplicate email as the same account', async () => {
    await registerUser(deps(repository), {
      account: 'dad@example.com',
      nickname: '爸爸',
      password: 'a-good-password',
    });
    const error = await registerUser(deps(repository), {
      account: 'DAD@Example.com',
      nickname: '冒名',
      password: 'another-password',
    }).catch((e: unknown) => e);
    expect((error as AuthError).code).toBe('user_exists');
  });

  it('rejects an unusable account, a blank nickname and a short password in one response', async () => {
    const error = await registerUser(deps(repository), {
      account: 'not-an-account',
      nickname: '   ',
      password: 'short',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AuthError);
    const details = (error as AuthError).details as { path: string }[];
    expect(details.map((issue) => issue.path).sort()).toEqual(['account', 'nickname', 'password']);
    expect(repository.count()).toBe(0);
  });

  it('rejects a missing or empty account', async () => {
    for (const account of ['', '   ']) {
      const error = await registerUser(deps(repository), {
        account,
        nickname: '弟弟',
        password: 'a-good-password',
      }).catch((e: unknown) => e);
      expect((error as AuthError).code).toBe('validation_error');
    }
    expect(repository.count()).toBe(0);
  });

  it('accepts the 6-character minimum the shipped UI allows, and rejects 5', async () => {
    const ok = await registerUser(deps(repository), {
      account: '13900139000',
      nickname: '六位',
      password: 'abcdef',
    });
    expect(ok.token.length).toBeGreaterThan(0);

    const tooShort = await registerUser(deps(repository), {
      account: '13700137000',
      nickname: '五位',
      password: 'abcde',
    }).catch((e: unknown) => e);
    expect((tooShort as AuthError).code).toBe('validation_error');
  });

  it('forwards lane B families verbatim and never computes points itself', async () => {
    const families = [
      {
        id: 'fam_1',
        name: '我们的家',
        role: 'owner' as const,
        points: 42.4,
        earnedPoints: 86.4,
        spentPoints: 44,
        frozenPoints: 5,
      },
    ];
    // a brand-new user normally has no family; injecting one proves the seam is a pure pass-through
    const result = await registerUser(
      deps(repository, { listFamilies: async () => families }),
      validPhone,
    );
    expect(result.families).toEqual(families);
  });
});

describe('normalizeRegistration (pure)', () => {
  it('returns the normalised registration for valid input', () => {
    expect(
      normalizeRegistration({
        account: ' +86 138-0013-8000 ',
        nickname: ' 弟弟 ',
        password: 'a-good-password',
      }),
    ).toEqual({
      accountKind: 'phone',
      account: '13800138000',
      nickname: '弟弟',
      password: 'a-good-password',
    });
  });

  it('classifies an email account and lower-cases it', () => {
    expect(normalizeRegistration({ account: 'A@B.com', nickname: 'x', password: 'abcdef' })).toMatchObject(
      { accountKind: 'email', account: 'a@b.com' },
    );
  });

  it('throws a validation error listing every problem at once', () => {
    const error = (() => {
      try {
        normalizeRegistration({ account: '', nickname: '', password: 'x' });
        return null;
      } catch (e: unknown) {
        return e as AuthError;
      }
    })();
    expect(error?.code).toBe('validation_error');
    expect((error?.details as unknown[]).length).toBeGreaterThanOrEqual(2);
  });
});
