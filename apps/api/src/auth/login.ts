/**
 * `POST /api/auth/login` use-case (CONTRACTS #4, PROJECT_GUIDE A1).
 *
 * Frozen shape: body `{account, password}` -> `{token, user, families}`.
 *
 * Two rules that matter more than the code:
 *
 *  1. "unknown account" and "wrong password" MUST be indistinguishable -- same status, same body --
 *     otherwise the endpoint becomes a phone-number oracle.
 *  2. Even then, an early return for an unknown account would leak the answer through response
 *     time, so the unknown-account path still performs one full scrypt verification against a
 *     throw-away hash.
 */
import { AuthError } from './errors.js';
import { listFamiliesFor } from './families.js';
import { normalizeAccount } from './identifiers.js';
import { toUserSummary } from './mapper.js';
import { hashPassword, hashSchemeOf, hasHasher, verifyPassword } from './password.js';
import type { AuthResult, AuthUseCaseDeps, AuthUserRecord, LoginInput } from './types.js';
import type { ValidationIssue } from './register.js';

let dummyHashPromise: Promise<string> | null = null;

/** Memoised so the timing equaliser costs one hash per process, not one per failed login. */
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('fcp-timing-equaliser-not-a-real-account');
  return dummyHashPromise;
}

export async function loginUser(deps: AuthUseCaseDeps, input: LoginInput): Promise<AuthResult> {
  const issues: ValidationIssue[] = [];
  const rawAccount = typeof input.account === 'string' ? input.account.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';

  if (rawAccount.length === 0) {
    issues.push({ path: 'account', message: 'account is required' });
  }
  if (password.length === 0) {
    issues.push({ path: 'password', message: 'password is required' });
  }
  if (issues.length > 0) throw AuthError.validation(issues);

  const account = normalizeAccount(rawAccount);
  if (account === null) {
    // Genuinely malformed input, not a hint about any account: safe to answer precisely.
    throw AuthError.validation([
      { path: 'account', message: 'account must be a phone number or an email address' },
    ]);
  }

  const record: AuthUserRecord | null =
    account.kind === 'email'
      ? await deps.repository.findByEmail(account.value)
      : await deps.repository.findByPhone(account.value);

  if (record === null) {
    await verifyPassword(password, await getDummyHash());
    throw AuthError.invalidCredentials('unknown_account');
  }

  const ok = await verifyPassword(password, record.pwdHash);
  if (!ok) {
    const scheme = hashSchemeOf(record.pwdHash);
    if (scheme === null || !hasHasher(scheme)) {
      // The user cannot log in until this hasher is registered -- make it loud in the logs instead
      // of leaving a silent lockout behind a generic 401 (see ops log, section 5, risk C).
      deps.logger.warn('stored password hash has no registered hasher', {
        scheme,
        userId: record.id,
      });
      throw AuthError.invalidCredentials('unregistered_password_scheme');
    }
    throw AuthError.invalidCredentials('password_mismatch');
  }

  const issued = deps.tokens.issue(record.id);
  return {
    token: issued.token,
    user: toUserSummary(record),
    families: await listFamiliesFor(deps, record.id),
  };
}
