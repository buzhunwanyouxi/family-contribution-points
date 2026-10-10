/**
 * In-memory implementation of the auth persistence port.
 *
 * Why it exists: `pnpm dev` and `pnpm test` must work on a fresh clone with zero database setup
 * (ADR-004 says newcomers should not have to install anything). It is also what makes the auth
 * use-cases unit-testable without mocking Prisma.
 *
 * It mirrors the database constraints on purpose -- `phone` / `email` uniqueness throws the same
 * `AuthError.userExists` a Prisma P2002 would -- so tests written against this repository stay
 * meaningful once `createPrismaAuthRepository()` is wired in.
 */
import { randomUUID } from 'node:crypto';
import { AuthError } from './errors.js';
import type { AuthRepository, AuthUserRecord, CreateUserInput } from './types.js';

export interface InMemoryAuthRepository extends AuthRepository {
  /** diagnostics / test assertions only -- never call this from production code paths */
  count(): number;
  /** test helper: insert rows without going through the password policy */
  seed(inputs: readonly CreateUserInput[]): AuthUserRecord[];
}

function copy(row: AuthUserRecord): AuthUserRecord {
  return { ...row };
}

export interface InMemoryAuthRepositoryOptions {
  /**
   * Timestamp source for new rows. Injectable because `createdAt` is a persistence concern (the real
   * adapter gets it from Prisma's `@default(now())`), so tests must be able to pin it here rather
   * than making every use-case carry a clock it would never use.
   */
  now?: () => Date;
}

export function createInMemoryAuthRepository(
  seed: readonly CreateUserInput[] = [],
  options: InMemoryAuthRepositoryOptions = {},
): InMemoryAuthRepository {
  const now = options.now ?? (() => new Date());
  const rowsById = new Map<string, AuthUserRecord>();
  const idByPhone = new Map<string, string>();
  const idByEmail = new Map<string, string>();

  function insert(input: CreateUserInput, id = randomUUID()): AuthUserRecord {
    if (input.phone !== null) {
      if (idByPhone.has(input.phone)) throw AuthError.userExists('phone');
    }
    if (input.email !== null) {
      if (idByEmail.has(input.email)) throw AuthError.userExists('email');
    }

    const row: AuthUserRecord = {
      id,
      phone: input.phone,
      email: input.email,
      nickname: input.nickname,
      avatarUrl: null,
      pwdHash: input.pwdHash,
      createdAt: now(),
    };
    rowsById.set(id, row);
    if (row.phone !== null) idByPhone.set(row.phone, id);
    if (row.email !== null) idByEmail.set(row.email, id);
    return copy(row);
  }

  for (const row of seed) insert(row);

  return {
    count(): number {
      return rowsById.size;
    },

    seed(inputs: readonly CreateUserInput[]): AuthUserRecord[] {
      return inputs.map((input) => insert(input));
    },

    async findById(id: string): Promise<AuthUserRecord | null> {
      const row = rowsById.get(id);
      return row === undefined ? null : copy(row);
    },

    async findByPhone(phone: string): Promise<AuthUserRecord | null> {
      const id = idByPhone.get(phone);
      if (id === undefined) return null;
      const row = rowsById.get(id);
      return row === undefined ? null : copy(row);
    },

    async findByEmail(email: string): Promise<AuthUserRecord | null> {
      const id = idByEmail.get(email.toLowerCase());
      if (id === undefined) return null;
      const row = rowsById.get(id);
      return row === undefined ? null : copy(row);
    },

    async create(input: CreateUserInput): Promise<AuthUserRecord> {
      return insert(input);
    },
  };
}
