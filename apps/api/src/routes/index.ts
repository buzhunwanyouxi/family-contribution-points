/**
 * SHARED FILE -- announce changes in your ops log before editing.
 * Route registration happens here so everyone can see the API surface at a glance.
 */
import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { scoringRoutes } from './scoring.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(scoringRoutes, { prefix: '/api/scoring' });
}