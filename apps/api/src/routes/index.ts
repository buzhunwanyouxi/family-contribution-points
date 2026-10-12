/**
 * SHARED FILE -- announce changes in your ops log before editing.
 * Route registration happens here so everyone can see the API surface at a glance.
 */
import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { scoringRoutes } from './scoring.js';
import { registerAuth } from './auth.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(scoringRoutes, { prefix: '/api/scoring' });

  // ---------------------------------------------------------------------------------------------
  // lane A / auth (W1-01) -- POST /api/auth/register, POST /api/auth/login, GET /api/auth/me.
  //
  // Called on the ROOT instance on purpose, and NOT via `app.register(..., { prefix })` as sketched
  // in DAY1-PLAN section 5. Reason: Fastify decorators added inside `app.register()` are
  // encapsulated, so `app.requireAuth` added there would be invisible to lane B and lane C -- and
  // DAY1-PLAN section 3 explicitly tells both of them to reuse lane A's middleware instead of
  // writing their own. Installing at the root is what makes that instruction actually work. The
  // three paths are absolute and match CONTRACTS #3-#5 exactly. See ops log section 3.
  // ---------------------------------------------------------------------------------------------
  await registerAuth(app);

  // lane B / family (W1-03..W1-06) -- paths frozen in CONTRACTS #6-#9:
  //   POST /api/families · POST /api/families/join · GET /api/families · GET /api/families/:fid/members
  // Uncomment once apps/api/src/routes/family.ts exists:
  // import { familyRoutes } from './family.js';
  // await app.register(familyRoutes, { prefix: '/api' });

  // lane C / media (W3-01) -- path frozen in CONTRACTS #10:
  //   POST /api/families/:fid/instances/:iid/proof
  // Uncomment once apps/api/src/routes/media.ts exists:
  // import { mediaRoutes } from './media.js';
  // await app.register(mediaRoutes, { prefix: '/api' });
}
