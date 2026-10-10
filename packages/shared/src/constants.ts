/**
 * Canonical numbers for the whole project. SHARED FILE: change these only through a guide update
 * (docs/PROJECT_GUIDE.md) and note it in your ops log.
 *
 * Every value can be overridden by an environment variable so that the deployed instance can be
 * tuned without a code change, but the defaults below are the agreed rules.
 *
 * The `process` lookup is guarded so this module can be imported from the browser bundle too.
 */

type EnvBag = Record<string, string | undefined>;

function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: EnvBag } }).process;
  return proc?.env?.[name];
}

function envInt(name: string, fallback: number): number {
  const raw = readEnv(name);
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 4.5 E7 - how long scorers have before the fallback settlement fires */
export const SCORE_WINDOW_HOURS = envInt('SCORE_WINDOW_HOURS', 24);

/** 4.5 E5 - anything below this is a rejection, not a low score */
export const SCORE_FLOOR_PERCENT = envInt('SCORE_FLOOR_PERCENT', 30);

/** 4.5 E6 - percentages snap to this step so points stay readable (1.2, not 1.83) */
export const SCORE_STEP_PERCENT = envInt('SCORE_STEP_PERCENT', 5);

/** 4.5 E9 - nobody scored at all: provisional settlement at this percentage */
export const SCORE_FALLBACK_PERCENT = envInt('SCORE_FALLBACK_PERCENT', 60);

/** 4.10 / D8 - proof photos and videos are deleted this many hours after upload */
export const PROOF_TTL_HOURS = envInt('PROOF_TTL_HOURS', 72);

/** 4.10 / D9 - reminders fire when this many hours remain (descending) */
export const PROOF_REMIND_BEFORE_HOURS: number[] = (readEnv('PROOF_REMIND_BEFORE_HOURS') ?? '24,6')
  .split(',')
  .map((v: string) => Number(v.trim()))
  .filter((v: number) => Number.isFinite(v) && v > 0);

/** 4.3 C3 - temporary task quotas, anti-abuse */
export const TEMP_TASK_DAILY_LIMIT = envInt('TEMP_TASK_DAILY_LIMIT', 3);
export const TEMP_TASK_MAX_BOUNTY = envInt('TEMP_TASK_MAX_BOUNTY', 50);

/** 4.4 D2 - free cancellation window after claiming */
export const CLAIM_GRACE_MINUTES = envInt('CLAIM_GRACE_MINUTES', 15);

/** 4.4 D4 - cooldown after repeated no-shows */
export const DISCIPLINE_STRIKE_LIMIT = envInt('DISCIPLINE_STRIKE_LIMIT', 3);
export const DISCIPLINE_COOLDOWN_DAYS = envInt('DISCIPLINE_COOLDOWN_DAYS', 7);

/** 4.5 E12 - how long a settlement can be appealed */
export const APPEAL_WINDOW_HOURS = envInt('APPEAL_WINDOW_HOURS', 24);

/** 4.5 E1 - the UI copy is fixed by the user, do not reword it casually */
export const SCORE_PROMPT = '您认为此次任务完成情况如何';
