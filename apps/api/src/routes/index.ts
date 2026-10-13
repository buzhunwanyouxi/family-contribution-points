/**
 * SHARED FILE -- announce changes in your ops log before editing.
 * Route registration happens here so everyone can see the API surface at a glance.
 */
import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { scoringRoutes } from './scoring.js';
import { registerAuth } from './auth.js';
import { registerFamily } from './family.js';
import { createFamilyDirectory, createFamilyService } from '../family/index.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(scoringRoutes, { prefix: '/api/scoring' });

  // ---------------------------------------------------------------------------------------------
  // lane B / family (W1-03..W1-06) -- paths frozen in CONTRACTS #6-#9:
  //   POST /api/families · POST /api/families/join · GET /api/families · GET /api/families/:fid/members
  //
  // The service is built here, rather than inside registerFamily(), because lane A needs the same
  // instance: CONTRACTS「auth 模块交付说明」makes wiring `familyDirectory` into `registerAuth`
  // lane B's hand-over duty. See ops log W1-B2, section 3.
  // ---------------------------------------------------------------------------------------------
  const familyService = createFamilyService();

  // ---------------------------------------------------------------------------------------------
  // lane A / auth (W1-01) -- POST /api/auth/register, POST /api/auth/login, GET /api/auth/me.
  //
  // Called on the ROOT instance on purpose, and NOT via `app.register(..., { prefix })` as sketched
  // in DAY1-PLAN section 5. Reason: Fastify decorators added inside `app.register()` are
  // encapsulated, so `app.requireAuth` added there would be invisible to lane B and lane C -- and
  // DAY1-PLAN section 3 explicitly tells both of them to reuse lane A's middleware instead of
  // writing their own. Installing at the root is what makes that instruction actually work. The
  // three paths are absolute and match CONTRACTS #3-#5 exactly. See ops log section 3.
  //
  // `familyDirectory` is lane B's hand-over point: without it `families` is always `[]`
  // (CONTRACTS rule 5); with it register / login / me all carry the family list.
  // ---------------------------------------------------------------------------------------------
  await registerAuth(app, { familyDirectory: createFamilyDirectory(familyService) });

  // Mounted AFTER registerAuth on purpose: the family routes reuse `app.requireAuth`, which only
  // exists once registerAuth() has decorated the root instance. registerFamily() fails loudly if it
  // is missing, instead of quietly serving family data without authentication.
  await registerFamily(app, { service: familyService });

  // lane C / media (W3-01) -- path frozen in CONTRACTS #10:
  //   POST /api/families/:fid/instances/:iid/proof
  // Uncomment once apps/api/src/routes/media.ts exists:
  // import { mediaRoutes } from './media.js';
  // await app.register(mediaRoutes, { prefix: '/api' });
}
