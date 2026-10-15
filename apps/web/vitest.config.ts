import { defineConfig } from 'vitest/config';

/**
 * The web package has two kinds of test, and they must not be confused:
 *
 *  - `*.test.ts`   -- fast, self-contained, no server needed.
 *  - `*.smoke.ts`  -- boots a real API process and walks the main flow over HTTP.
 *
 * `pnpm test` runs both; `pnpm test:unit` skips the server-bound one.
 *
 * Why `pool: 'forks'` and `fileParallelism: false` (2026-10-15)
 * -------------------------------------------------------------
 * With vitest's default thread pool this suite **hung indefinitely with no output at all** on this
 * machine -- not even a failing assertion, just silence, and the spawned API process was left
 * listening. A minimal test that touched nothing (no server, no network) hung the same way, which
 * ruled out the smoke test as the cause and pointed at the pool itself: worker threads do not come
 * up in this environment.
 *
 * A single forked process is slower but actually runs. The suite is tiny, so the cost is irrelevant,
 * and a test runner that silently does nothing is worse than no test runner at all -- it would have
 * looked like "tests pass" while checking nothing.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.smoke.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
