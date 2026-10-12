import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from './errors.js';
import { DEFAULT_ISSUER, createHs256Codec } from './jwt.js';
import { loginUser } from './login.js';
import { createInMemoryAuthRepository } from './repository.js';
import type { InMemoryAuthRepository } from './repository.js';
import { registerUser } from './register.js';
import type { AuthLogger, AuthUseCaseDeps, FamilyDirectoryPort } from './types.js';

function makeDeps(
  repository: InMemoryAuthRepository,
  logger: AuthLogger = { warn: () => {} },
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
    logger,
  };
  if (familyDirectory !== undefined) built.familyDirectory = familyDirectory;
  return built;
}

describe('loginUser (CONTRACTS #4)', () => {
  let repository: InMemoryAuthRepository;
  let deps: AuthUseCaseDeps;
  const password = 'a-good-password';

  beforeEach(async () => {
    repository = createInMemoryAuthRepository();
    deps = makeDeps(repository);
    await registerUser(deps, { account: '13800138000', nickname: '弟弟', password });
    await registerUser(deps, { account: 'dad@example.com', nickname: '爸爸', password });
  });

  it('logs in by phone and returns exactly {token, user, families}', async () => {
    const result = await loginUser(deps, { account: '13800138000', password });
    expect(Object.keys(result).sort()).toEqual(['families', 'token', 'user']);
    expect(result.user.nickname).toBe('弟弟');
    expect(result.families).toEqual([]);
    expect(deps.tokens.verifyToken(result.token).sub).toBe(result.user.id);
  });

  it('logs in by email, ignoring case and surrounding spaces', async () => {
    const result = await loginUser(deps, { account: '  DAD@Example.com ', password });
    expect(result.user.nickname).toBe('爸爸');
  });

  it('accepts a phone number typed with a country code and separators', async () => {
    const result = await loginUser(deps, { account: '+86 138-0013-8000', password });
    expect(result.user.phone).toBe('13800138000');
  });

  it('rejects a wrong password', async () => {
    const error = await loginUser(deps, { account: '13800138000', password: 'wrong-password' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).code).toBe('invalid_credentials');
    expect((error as AuthError).status).toBe(401);
    expect((error as AuthError).userMessage).toBe('账号或密码不正确');
  });

  it('answers an unknown account with exactly the same error as a wrong password', async () => {
    const unknown = await loginUser(deps, { account: '13900139000', password }).catch((e: unknown) => e);
    const wrong = await loginUser(deps, { account: '13800138000', password: 'nope-nope-nope' })
      .catch((e: unknown) => e);

    expect((unknown as AuthError).code).toBe((wrong as AuthError).code);
    expect((unknown as AuthError).status).toBe((wrong as AuthError).status);
    expect((unknown as AuthError).message).toBe((wrong as AuthError).message);
    expect((unknown as AuthError).userMessage).toBe((wrong as AuthError).userMessage);
    // only the server-side log reason differs, and that never reaches the client
    expect((unknown as AuthError).logReason).not.toBe((wrong as AuthError).logReason);
  });

  it('validates an empty or malformed account before touching the repository', async () => {
    const findSpy = vi.spyOn(repository, 'findByPhone');

    const empty = await loginUser(deps, { account: '   ', password }).catch((e: unknown) => e);
    expect((empty as AuthError).code).toBe('validation_error');

    const noPassword = await loginUser(deps, { account: '13800138000', password: '' })
      .catch((e: unknown) => e);
    expect((noPassword as AuthError).code).toBe('validation_error');

    const garbage = await loginUser(deps, { account: 'abc', password }).catch((e: unknown) => e);
    expect((garbage as AuthError).code).toBe('validation_error');

    expect(findSpy).not.toHaveBeenCalled();
  });

  it('forwards lane B families on login too (contract rule 5)', async () => {
    const families = [
      {
        id: 'fam_1',
        name: '我们的家',
        role: 'member' as const,
        points: 0,
        earnedPoints: 0,
        spentPoints: 0,
        frozenPoints: 0,
      },
    ];
    const result = await loginUser(makeDeps(repository, { warn: () => {} }, { listFamilies: async () => families }), {
      account: '13800138000',
      password,
    });
    expect(result.families).toEqual(families);
  });

  it('warns loudly when the stored hash uses a scheme with no registered hasher', async () => {
    // Simulates a bcrypt row existing before the bcrypt hasher was registered: today's behaviour is
    // a generic 401, and the ops log records this as the known limitation to fix before that swap.
    repository.seed([
      { phone: '13700137000', email: null, nickname: '爷爷', pwdHash: '$2b$10$abcdefghijklmnopqrstuv' },
    ]);
    const warn = vi.fn();
    const withLogger = makeDeps(repository, { warn });

    const error = await loginUser(withLogger, { account: '13700137000', password })
      .catch((e: unknown) => e);

    expect((error as AuthError).code).toBe('invalid_credentials');
    expect((error as AuthError).logReason).toBe('unregistered_password_scheme');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ scheme: 'bcrypt' });
  });
});
