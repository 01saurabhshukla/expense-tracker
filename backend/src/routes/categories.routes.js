import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { CATEGORIES } from '../categorize/categories.js';
import * as transactionsService from '../services/transactions.service.js';

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth);

// The fixed category list (D25), for dropdowns and chart labels.
categoriesRouter.get('/', (req, res) => {
  res.json({ categories: CATEGORIES });
});

// The user's remembered corrections ("always put this merchant in …").
categoriesRouter.get('/rules', async (req, res) => {
  res.json(await transactionsService.listRules(req.user.id));
});

categoriesRouter.delete('/rules/:id', async (req, res) => {
  await transactionsService.deleteRule(req.user.id, req.params.id);
  res.status(204).end();
});
