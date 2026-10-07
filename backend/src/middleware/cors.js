import { AppError } from '../errors.js';

// CORS: which websites' JavaScript may call this API from a browser.
//
// The frontend is hosted separately (D2), so the browser sees it as another
// origin and asks permission. Only the origins in `allowedOrigins` (env
// CORS_ORIGINS) get it.
//
// Stricter than plain CORS: a request that carries an Origin header we don't
// allow is REJECTED (403), not just hidden from the page. Browsers send
// Origin on every cross-origin request, so a page on another site can't make
// the user's browser change anything here (e.g. post to /auth/refresh with
// the user's cookie). Tools like curl send no Origin and are unaffected —
// they still need a token like everyone else.
const ALLOWED_METHODS = 'GET, POST, PATCH, DELETE';
const ALLOWED_HEADERS = 'Authorization, Content-Type, X-Request-Id';
// Headers the frontend may read: the request id (for support), the
// download's file name, and how long to wait after a 429.
const EXPOSED_HEADERS = 'X-Request-Id, Content-Disposition, Retry-After';
const PREFLIGHT_CACHE_SECONDS = 600;

export function cors(allowedOrigins) {
  const allowed = new Set(allowedOrigins);

  return (req, res, next) => {
    // Responses differ by Origin: caches must keep them apart.
    res.vary('Origin');

    const origin = req.get('origin');
    if (origin === undefined) return next(); // not a cross-origin browser request

    if (!allowed.has(origin)) {
      return next(new AppError(403, 'CORS_ORIGIN_NOT_ALLOWED', 'This website is not allowed to use the API'));
    }

    res.set({
      'Access-Control-Allow-Origin': origin, // the exact origin, never "*", because…
      'Access-Control-Allow-Credentials': 'true', // …the refresh cookie must be sent
      'Access-Control-Expose-Headers': EXPOSED_HEADERS,
    });

    // Preflight: the browser asks before a request with a token, JSON or a
    // method like PATCH. Answer and stop; the real request comes next.
    if (req.method === 'OPTIONS' && req.get('access-control-request-method')) {
      res.set({
        'Access-Control-Allow-Methods': ALLOWED_METHODS,
        'Access-Control-Allow-Headers': ALLOWED_HEADERS,
        'Access-Control-Max-Age': String(PREFLIGHT_CACHE_SECONDS),
      });
      return res.status(204).end();
    }
    next();
  };
}
