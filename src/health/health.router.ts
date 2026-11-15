import { Router } from 'express';

import { isDatabaseConnected } from '../infrastructure/database.js';

/** Used by the Docker healthcheck and load balancers: healthy only while MongoDB is reachable. */
export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    if (isDatabaseConnected()) {
      res.json({ status: 'ok', database: 'up' });
    } else {
      res.status(503).json({ status: 'unavailable', database: 'down' });
    }
  });

  return router;
}
