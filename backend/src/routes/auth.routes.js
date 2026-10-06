import { Router } from 'express';
import { env } from '../config/env.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { signupSchema, loginSchema } from '../schemas/auth.js';
import { REFRESH_TOKEN_TTL_MS } from '../services/tokens.js';
import * as authService from '../services/auth.service.js';

export const authRouter = Router();

const REFRESH_COOKIE = 'refresh_token';

// clearCookie only works if path/sameSite/secure match the ones used to set it,
// so both share these options.
const refreshCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/auth',
};

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_TTL_MS });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
}

authRouter.post('/signup', validateBody(signupSchema), async (req, res) => {
  const user = await authService.signup(req.body);
  res.status(201).json({ user });
});

authRouter.post('/login', validateBody(loginSchema), async (req, res) => {
  const { refreshToken, ...result } = await authService.login(req.body);
  setRefreshCookie(res, refreshToken);
  res.json(result);
});

authRouter.post('/refresh', async (req, res) => {
  try {
    const { refreshToken, ...result } = await authService.refresh(req.cookies[REFRESH_COOKIE]);
    setRefreshCookie(res, refreshToken);
    res.json(result);
  } catch (err) {
    // The cookie is useless now; remove it so the browser stops sending it.
    clearRefreshCookie(res);
    throw err;
  }
});

authRouter.post('/logout', async (req, res) => {
  await authService.logout(req.cookies[REFRESH_COOKIE]);
  clearRefreshCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await authService.getCurrentUser(req.user.id);
  res.json({ user });
});
