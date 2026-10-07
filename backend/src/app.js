import express from 'express';
import cookieParser from 'cookie-parser';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/logger.js';
import { cors } from './middleware/cors.js';
import { env } from './config/env.js';
import { limits } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.routes.js';
import { uploadsRouter } from './routes/uploads.routes.js';
import { transactionsRouter } from './routes/transactions.routes.js';
import { categoriesRouter } from './routes/categories.routes.js';
import { dashboardRouter } from './routes/dashboard.routes.js';
import { exportsRouter } from './routes/exports.routes.js';

export function createApp() {
  const app = express();
  // req.ip = the real client, read from X-Forwarded-For only when the request
  // came through the proxy we trust (T10). The rate limiter keys on it.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);
  app.use(requestLogger);
  // Before everything else that answers: even errors (401 TOKEN_EXPIRED)
  // must carry the CORS headers, or the frontend can't read them.
  app.use(cors(env.CORS_ORIGINS));
  // A ceiling for every route (after CORS, so a 429 can be read by the
  // frontend; before body parsing, so a flood costs as little as possible).
  app.use(limits.api());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/health', (req, res) => {
    // throw new Error('boom');
    res.json({ status: 'ok' });
  });

  app.use('/auth', authRouter);
  app.use('/uploads', uploadsRouter);
  app.use('/transactions', transactionsRouter);
  app.use('/categories', categoriesRouter);
  app.use('/dashboard', dashboardRouter);
  app.use('/exports', exportsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
