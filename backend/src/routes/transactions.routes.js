import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { listTransactionsQuerySchema, updateTransactionSchema } from '../schemas/transactions.js';
import * as transactionsService from '../services/transactions.service.js';

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);

// GET /transactions?from&to&category&direction&uploadId&q&sort&limit&offset
transactionsRouter.get('/', validateQuery(listTransactionsQuerySchema), async (req, res) => {
  res.json(await transactionsService.listTransactions(req.user.id, req.validatedQuery));
});

// PATCH /transactions/:id { category, applyToMerchant? }
transactionsRouter.patch('/:id', validateBody(updateTransactionSchema), async (req, res) => {
  res.json(await transactionsService.updateCategory(req.user.id, req.params.id, req.body));
});
