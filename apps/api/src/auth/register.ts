/**
 * `POST /api/auth/register` use-case (CONTRACTS #3, PROJECT_GUIDE A1).
 *
 * Frozen shape: body `{account, password, nickname}` -> `{token, user, families}`.
 * `account` is a SINGLE field carrying either a phone number or an email address; the backend
 * decides which, so `phone` / `email` are not accepted as separate request fields.
 *
 * Flow: validate -> normalise -> uniqueness pre-check -> hash -> persist -> issue token -> families.
 *
 * The uniqueness pre-check gives a friendly 409 in the common case; the database index is the real
 * referee for concurrent registrations, which is why the adapter maps Prisma P2002 onto the same
 * `user_exists` error. Both paths therefore produce one identical response.
 */
import { AuthError } from './errors.js';
import { listFamiliesFor } from './families.js';
import {
  NICKNAME_MAX_LENGTH,
  normalizeAccount,
  normalizeNickname,
  type AccountKind,
} from './identifiers.js';
import { toUserSummary } from './mapper.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, hashPassword } from './password.js';
import type { AuthResult, AuthUseCaseDeps, RegisterInput } from './types.js';

export interface ValidationIssue {
  path: string;
  message: string;
}

/** Shared with the route layer so a bad password is reported the same way in both places. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) return 'password is required';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  return null;
}

export interface NormalizedRegistration {
  /** which kind of account the client actually sent */
  accountKind: AccountKind;
  /** normalised phone digits or lower-cased email -- this is what goes into the database */
  account: string;
  nickname: string;
  password: string;
}

/** Pure validation/normalisation, exported so it can be unit tested without a repository. */
export function normalizeRegistration(input: RegisterInput): NormalizedRegistration {
  const issues: ValidationIssue[] = [];

  const rawAccount = typeof input.account === 'string' ? input.account.trim() : '';
  if (rawAccount.length === 0) {
    issues.push({ path: 'account', message: 'account is required (a phone number or an email)' });
  }
  const account = rawAccount.length === 0 ? null : normalizeAccount(rawAccount);
  if (rawAccount.length > 0 && account === null) {
    issues.push({ path: 'account', message: 'account must be a phone number or an email address' });
  }

  const nickname = normalizeNickname(typeof input.nickname === 'string' ? input.nickname : '');
  if (nickname === null) {
    issues.push({
      path: 'nickname',
      message: `nickname must be 1-${NICKNAME_MAX_LENGTH} characters`,
    });
  }

  const problem = passwordProblem(input.password);
  if (problem !== null) issues.push({ path: 'password', message: problem });

  if (issues.length > 0) throw AuthError.validation(issues);

  if (account === null || nickname === null) {
    // Unreachable: every null path above already pushed an issue -- kept so the types narrow
    // without non-null assertions.
    throw AuthError.validation([{ path: 'account', message: 'account is required' }]);
  }

  return {
    accountKind: account.kind,
    account: account.value,
    nickname,
    password: input.password,
  };
}

export async function registerUser(
  deps: AuthUseCaseDeps,
  input: RegisterInput,
): Promise<AuthResult> {
  const { accountKind, account, nickname, password } = normalizeRegistration(input);

  const existing =
    accountKind === 'email'
      ? await deps.repository.findByEmail(account)
      : await deps.repository.findByPhone(account);
  if (existing !== null) throw AuthError.userExists(accountKind);

  const pwdHash = await hashPassword(password);

  // No try/catch needed: a lost race surfaces as `AuthError.userExists` from the adapter, which is
  // the exact error the pre-check above would have thrown.
  const record = await deps.repository.create({
    phone: accountKind === 'phone' ? account : null,
    email: accountKind === 'email' ? account : null,
    nickname,
    pwdHash,
  });

  const issued = deps.tokens.issue(record.id);
  return {
    token: issued.token,
    user: toUserSummary(record),
    // a brand-new account has no family yet: CONTRACTS rule 5 requires `[]`, not an error
    families: await listFamiliesFor(deps, record.id),
  };
}
