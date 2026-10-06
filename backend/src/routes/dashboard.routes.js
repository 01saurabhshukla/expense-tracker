import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import { dashboardQuerySchema } from '../schemas/transactions.js';
import { getDashboard } from '../services/dashboard.service.js';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

// GET /dashboard?from&to&category&direction&uploadId&q&granularity=day|week|month
dashboardRouter.get('/', validateQuery(dashboardQuerySchema), async (req, res) => {
  res.json(await getDashboard(req.user.id, req.validatedQuery));
});
