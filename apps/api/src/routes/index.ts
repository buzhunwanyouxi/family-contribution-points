/**
 * SHARED FILE -- announce changes in your ops log before editing.
 * Route registration happens here so everyone can see the API surface at a glance.
 *
 * Composition (who owns which instance) lives in `apps/api/src/composition.ts`; this file only
 * mounts. Splitting it out was forced by a real bug: auth and family each fell back to their own
 * in-memory repository, so accounts created by auth were invisible to family and
 * `POST /api/families` answered 500 while all 215 unit tests stayed green. See ops log
 * `2026-10-13-2200_W1-WIRE_cross-module.md`.
 */
import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { scoringRoutes } from './scoring.js';
import { registerAuth } from './auth.js';
import { registerFamily } from './family.js';
import { registerPoints } from './points.js';
import { createAppServices } from '../composition.js';
import type { AppServices } from '../composition.js';

export interface RegisterRoutesOptions {
  /**
   * Pre-built services. Pass these whenever a caller needs to reach the very same instances --
   * tests do, and a future job runner will. Omit and the default pair is built here.
   */
  services?: AppServices;
  /** JWT secret used only when `services` is omitted. */
  secret?: string;
}

export async function registerRoutes(
  app: FastifyInstance,
  options: RegisterRoutesOptions = {},
): Promise<void> {
  await app.register(healthRoutes);
  await app.register(scoringRoutes, { prefix: '/api/scoring' });

  const services =
    options.services ??
    createAppServices(options.secret === undefined ? {} : { secret: options.secret });

  // ---------------------------------------------------------------------------------------------
  // lane A / auth (W1-01) -- POST /api/auth/register, POST /api/auth/login, GET /api/auth/me.
  //
  // Called on the ROOT instance on purpose, and NOT via `app.register(..., { prefix })` as sketched
  // in DAY1-PLAN section 5. Reason: Fastify decorators added inside `app.register()` are
  // encapsulated, so `app.requireAuth` added there would be invisible to lane B and lane C -- and
  // DAY1-PLAN section 3 explicitly tells both of them to reuse lane A's middleware instead of
  // writing their own. Installing at the root is what makes that instruction actually work. The
  // three paths are absolute and match CONTRACTS #3-#5 exactly. See lane A's ops log section 3.
  //
  // `service` (not `repository`) is passed so auth writes to the same user store the family service
  // reads from; `familyDirectory` is already wired inside createAppServices (CONTRACTS rule 5).
  // ---------------------------------------------------------------------------------------------
  await registerAuth(app, { service: services.authService });

  // Mounted AFTER registerAuth on purpose: the family routes reuse `app.requireAuth`, which only
  // exists once registerAuth() has decorated the root instance. registerFamily() fails loudly if it
  // is missing, instead of quietly serving family data without authentication.
  await registerFamily(app, { service: services.familyService });

  // lane C / points (W1-F) -- GET /api/families/:fid/points/:uid (CONTRACTS #15).
  // Same ordering rule as family: it needs `app.requireAuth` from registerAuth(). It shares the
  // family repository because the four numbers live on `Membership`, and the ledger's rule is that
  // they are **forwarded**, never recomputed here.
  await registerPoints(app, { repository: services.familyRepository });

  // lane C / media (W3-01) -- path frozen in CONTRACTS #10:
  //   POST /api/families/:fid/instances/:iid/proof
  // Uncomment once apps/api/src/routes/media.ts exists:
  // import { mediaRoutes } from './media.js';
  // await app.register(mediaRoutes, { prefix: '/api' });
}
