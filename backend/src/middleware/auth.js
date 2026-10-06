import { AppError } from '../errors.js';
import { verifyAccessToken } from '../services/tokens.js';

export function requireAuth(req, res, next) {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'UNAUTHENTICATED', 'Missing or malformed Authorization header'));
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub };
    next();
  } catch (err) {
    // A separate code for expiry tells the frontend "refresh and retry"
    // instead of "send the user back to the login page".
    if (err.name === 'TokenExpiredError') {
      return next(new AppError(401, 'TOKEN_EXPIRED', 'Access token has expired'));
    }
    next(new AppError(401, 'INVALID_TOKEN', 'Access token is invalid'));
  }
}
