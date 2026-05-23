import { Router } from 'express';
import { DaemonContext } from '../server';

export function createHealthRouter(ctx: DaemonContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      version: ctx.version,
      uptimeMs: Date.now() - ctx.startedAt,
    });
  });

  return router;
}
