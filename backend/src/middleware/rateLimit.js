import { AppError } from '../errors.js';
import { env } from '../config/env.js';

// A basic fixed-window rate limiter, counted in memory (T9).
//
// Each key (the client's IP, req.ip — see D35) gets a counter that starts
// at the first request and resets `windowMs` later. Request number max+1
// inside the window is refused with 429 and a Retry-After header.
//
// Known limits, accepted for one API process on one server (T9):
//   - at a window's edge a client can briefly get up to 2 × max through;
//   - counts reset when the process restarts;
//   - with several servers each would count separately.
//
// `name` appears in the error message ("Too many login attempts…").
export function rateLimit({ name, windowMs, max, key = (req) => req.ip, now = Date.now }) {
  const windows = new Map(); // key → { count, resetAt }

  // Forget finished windows, so memory doesn't grow with every IP ever seen.
  const cleanup = setInterval(() => {
    const t = now();
    for (const [k, w] of windows) if (w.resetAt <= t) windows.delete(k);
  }, windowMs);
  cleanup.unref(); // never keeps the process alive on its own

  return (req, res, next) => {
    if (!env.RATE_LIMIT_ENABLED) return next();

    const t = now();
    const k = key(req);
    let w = windows.get(k);
    if (!w || w.resetAt <= t) {
      w = { count: 0, resetAt: t + windowMs };
      windows.set(k, w);
    }
    w.count++;

    const retryAfterSeconds = Math.ceil((w.resetAt - t) / 1000);
    // Standard headers so clients can slow down before hitting the limit.
    res.set({
      'RateLimit-Limit': String(max),
      'RateLimit-Remaining': String(Math.max(0, max - w.count)),
      'RateLimit-Reset': String(retryAfterSeconds),
    });

    if (w.count > max) {
      res.set('Retry-After', String(retryAfterSeconds));
      return next(
        new AppError(429, 'RATE_LIMITED', `Too many ${name}. Please try again in ${humanDuration(retryAfterSeconds)}.`, {
          retryAfterSeconds,
        }),
      );
    }
    next();
  };
}

function humanDuration(seconds) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

const MINUTE = 60_000;

// The limits, in one place.
export const limits = {
  // Slows password guessing: 10 tries per 15 minutes per IP.
  login: () => rateLimit({ name: 'login attempts', windowMs: 15 * MINUTE, max: 10 }),
  // Stops mass account creation from one place.
  signup: () => rateLimit({ name: 'sign-ups from this network', windowMs: 60 * MINUTE, max: 5 }),
  // Several open tabs refresh now and then; this is far above normal use.
  refresh: () => rateLimit({ name: 'session refreshes', windowMs: 15 * MINUTE, max: 60 }),
  // Everything else: a ceiling against floods, far above a person clicking.
  api: () => rateLimit({ name: 'requests', windowMs: MINUTE, max: 300 }),
};
