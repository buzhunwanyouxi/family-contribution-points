/**
 * Maps a persistence row onto the wire shape frozen in `docs/CONTRACTS.md` "前端调用约定".
 *
 * Two deliberate rules:
 *   1. `pwdHash` is unreachable from here -- routes never receive a row in the first place.
 *   2. Optional fields are **omitted when absent**, not set to `null`. The frozen type is
 *      `phone?: string`, and `null` is not assignable to it; emitting `null` would silently break
 *      the contract the frontend was written against.
 *
 * `createdAt` is intentionally not exposed: it is not part of the frozen `UserSummary`.
 */
import type { AuthUserRecord, UserSummary } from './types.js';

export function toUserSummary(record: AuthUserRecord): UserSummary {
  const summary: UserSummary = {
    id: record.id,
    nickname: record.nickname,
  };
  if (record.avatarUrl !== null) summary.avatarUrl = record.avatarUrl;
  if (record.phone !== null) summary.phone = record.phone;
  if (record.email !== null) summary.email = record.email;
  return summary;
}
