import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import { transactionFiltersSchema } from '../schemas/transactions.js';
import { exportCsv, exportPdf } from '../services/export.service.js';

export const exportsRouter = Router();

exportsRouter.use(requireAuth);

// Same filters as GET /transactions and GET /dashboard.
exportsRouter.get('/transactions.csv', validateQuery(transactionFiltersSchema), async (req, res) => {
  await exportCsv(req.user.id, req.validatedQuery, res);
});

exportsRouter.get('/report.pdf', validateQuery(transactionFiltersSchema), async (req, res) => {
  await exportPdf(req.user.id, req.validatedQuery, res);
});
