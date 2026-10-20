/**
 * The task-instance state machine -- **the only place in this repository that decides whether a
 * status change is legal**.
 *
 * Why it is pure functions in their own module rather than methods on the service:
 *
 *  - The transition table is the rule most likely to be duplicated. A claim route that does
 *    `instance.status = 'claimed'` would pass its own tests and then disagree with settlement, which
 *    is the same failure shape as "two implementations of the points arithmetic" that this project
 *    already forbids (`AGENTS.md` section 5). Keeping the table here means a route *cannot* make a
 *    status decision without importing it.
 *  - It is fully testable with no repository, no clock and no HTTP.
 *
 * ## Repeating the same status is not a transition
 *
 * `doing -> doing` is allowed and returns "no change". The tempting alternative -- reject it as
 * illegal -- turns an idempotent retry into a 409, so a double-tap on "开始" would show an error even
 * though nothing was wrong. **Illegal means "skipping a step"**, e.g. `open -> done`, and that is what
 * this module refuses.
 *
 * ## `abandoned` is reachable from every live status
 *
 * A task can be called off at any point before settlement (the child leaves for a week, the parent
 * cancels). Once settled there is no going back: `done`/`rejected`/`abandoned` are terminal, because
 * undoing them would mean unpicking points that were already awarded.
 */
import type { InstanceStatus } from './types.js';

/** Allowed transitions, as a plain table so it can be read at a glance. */
const TRANSITIONS: Readonly<Record<InstanceStatus, readonly InstanceStatus[]>> = {
  open: ['claimed', 'abandoned'],
  claimed: ['doing', 'open', 'abandoned'],
  doing: ['pending_score', 'open', 'abandoned'],
  pending_score: ['done', 'rejected', 'abandoned'],
  done: [],
  rejected: [],
  abandoned: [],
};

export type TransitionVerdict =
  /** Legal and changes the status. */
  | { ok: true; kind: 'change' }
  /** Legal but a no-op (same status). Idempotent retries land here. */
  | { ok: true; kind: 'noop' }
  /** Not in the table. */
  | { ok: false };

/**
 * Decide whether `from -> to` is allowed.
 *
 * Returns a verdict rather than throwing, so callers can choose the error (claim has its own
 * `already_claimed` message, settlement has its own).
 */
export function canTransition(from: InstanceStatus, to: InstanceStatus): TransitionVerdict {
  if (from === to) return { ok: true, kind: 'noop' };
  return TRANSITIONS[from].includes(to) ? { ok: true, kind: 'change' } : { ok: false };
}

/** Everything reachable from a status. Empty for terminal ones. */
export function nextStatuses(from: InstanceStatus): readonly InstanceStatus[] {
  return TRANSITIONS[from];
}

/** Terminal = nothing can follow. Derived from the table so the two can never disagree. */
export function isTerminal(status: InstanceStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Live = can still be claimed, worked on, or settled. */
export function isLive(status: InstanceStatus): boolean {
  return !isTerminal(status);
}

/**
 * D2: the free-cancel window after claiming, in milliseconds.
 *
 * 15 minutes is the rule (`PROJECT_GUIDE` D2). Exported so the claim route and its tests cannot drift
 * apart, and so the number appears exactly once in the codebase.
 */
export const FREE_CANCEL_WINDOW_MS = 15 * 60 * 1000;

/**
 * Is releasing the instance still free of consequences (D2)?
 *
 * At exactly 15 minutes it is **no longer free** (`>=`): the window is "within 15 minutes", and a
 * boundary that rounds in the user's favour would let a 15m01s release hide behind a 15m00s rule.
 */
export function isWithinFreeCancel(claimedAt: Date, now: Date): boolean {
  return now.getTime() - claimedAt.getTime() < FREE_CANCEL_WINDOW_MS;
}

/**
 * Has the deadline passed? At exactly `deadlineAt` it is overdue, matching the "到点仍无人接" wording
 * of D5 rather than a grace period nobody wrote down.
 */
export function isOverdue(deadlineAt: Date, now: Date): boolean {
  return now.getTime() >= deadlineAt.getTime();
}
