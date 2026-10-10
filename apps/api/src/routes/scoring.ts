/**
 * Scoring preview endpoint.
 *
 * Implements PROJECT_GUIDE 4.5 (E1-E14) as a *pure* preview so that the web client and the
 * future settlement job cannot drift apart. The real settlement writes PointsTxn rows; this
 * route only computes the outcome and is safe to call repeatedly.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { previewSettlement } from '../scoring/settle.js';

const scoreInput = z.object({
  scorerId: z.string().min(1),
  isOwner: z.boolean(),
  percent: z.number().int().min(0).max(100),
  createdAt: z.string().optional(),
});

const previewInput = z.object({
  maxPoints: z.number().positive(),
  scores: z.array(scoreInput),
});

export async function scoringRoutes(app: FastifyInstance): Promise<void> {
  app.post('/preview', async (request, reply) => {
    const parsed = previewInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    const result = previewSettlement(parsed.data);
    return reply.send(result);
  });
}