/**
 * Prisma adapter for the auth persistence port -- the real database implementation.
 *
 * Deliberately STRUCTURAL: it does not import `@prisma/client`, so
 *   - `pnpm -r typecheck` stays green even before `pnpm db:generate` has ever run, and
 *   - the auth module never depends on the generated client (which is gitignored).
 *
 * Wiring it up is one object (see docs/CONTRACTS.md "auth 跨模块联动"):
 *
 *   import { PrismaClient } from '@prisma/client';
 *   import { createPrismaAuthRepository } from './auth/repository.prisma.js';
 *   import { createAuthService } from './auth/index.js';
 *
 *   const prisma = new PrismaClient();
 *   const auth = createAuthService({ repository: createPrismaAuthRepository(prisma) });
 *
 * The delegate surface below is exactly the subset of `prisma.user` this module uses:
 *   register -> user.create
 *   login    -> user.findUnique({ where: { phone } }) / ({ where: { email } })
 *   me       -> user.findUnique({ where: { id } })
 * Changing `schema.prisma` in a way that breaks any of those is a contract change -- say so in the
 * ops log and in CONTRACTS.md (schema.prisma is a shared file).
 */
import { AuthError } from './errors.js';
import type { AuthRepository, AuthUserRecord, CreateUserInput } from './types.js';

/** The User row as Prisma returns it (matches `model User` in prisma/schema.prisma). */
export interface PrismaUserRow {
  id: string;
  phone: string | null;
  email: string | null;
  nickname: string;
  avatarUrl: string | null;
  pwdHash: string;
  createdAt: Date;
}

export interface PrismaUserDelegate {
  findUnique(args: { where: Record<string, unknown> }): Promise<PrismaUserRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<PrismaUserRow>;
}

/** Structural `PrismaClient` -- pass the real client, it satisfies this shape. */
export interface PrismaLikeClient {
  user: PrismaUserDelegate;
}

/** Prisma's unique-constraint violation code. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

function uniqueViolationField(error: unknown): 'phone' | 'email' {
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const flat = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return flat.includes('email') ? 'email' : 'phone';
}

export function createPrismaAuthRepository(client: PrismaLikeClient): AuthRepository {
  return {
    async findById(id: string): Promise<AuthUserRecord | null> {
      return client.user.findUnique({ where: { id } });
    },

    async findByPhone(phone: string): Promise<AuthUserRecord | null> {
      return client.user.findUnique({ where: { phone } });
    },

    async findByEmail(email: string): Promise<AuthUserRecord | null> {
      // rows are stored lower-cased by register.ts, so a plain unique lookup IS case-insensitive
      return client.user.findUnique({ where: { email: email.toLowerCase() } });
    },

    async create(input: CreateUserInput): Promise<AuthUserRecord> {
      try {
        return await client.user.create({
          data: {
            phone: input.phone,
            email: input.email,
            nickname: input.nickname,
            pwdHash: input.pwdHash,
          },
        });
      } catch (error) {
        // Two concurrent registrations can both pass the pre-check; the DB index is the referee.
        if (isUniqueViolation(error)) throw AuthError.userExists(uniqueViolationField(error));
        throw error;
      }
    },
  };
}
