// The rate limiter: the window logic with a fake clock, then the real login
// limit through the app. The test script turns limiting off for every other
// file (RATE_LIMIT_ENABLED=false); this file turns it back on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.RATE_LIMIT_ENABLED = 'true'; // before the app reads env

const { rateLimit } = await import('../src/middleware/rateLimit.js');
const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');

after(() => pool.end());

// Runs the middleware for one fake request; returns what happened.
function hit(limiter, ip = '198.51.100.1') {
  const headers = {};
  const res = { set: (h, v) => (typeof h === 'string' ? (headers[h] = v) : Object.assign(headers, h)) };
  let error;
  limiter({ ip }, res, (err) => (error = err));
  return { error, headers };
}

test('allows `max` requests per window, then refuses with 429 and Retry-After', () => {
  let clock = 1_000_000;
  const limiter = rateLimit({ name: 'tries', windowMs: 60_000, max: 3, now: () => clock });

  for (let i = 1; i <= 3; i++) {
    const { error, headers } = hit(limiter);
    assert.equal(error, undefined, `request ${i}`);
    assert.equal(headers['RateLimit-Remaining'], String(3 - i));
  }

  clock += 20_000; // 40 s of the window left
  const refused = hit(limiter);
  assert.equal(refused.error.status, 429);
  assert.equal(refused.error.code, 'RATE_LIMITED');
  assert.equal(refused.error.details.retryAfterSeconds, 40);
  assert.equal(refused.headers['Retry-After'], '40');
  assert.match(refused.error.message, /Too many tries\. Please try again in 40 seconds\./);
});

test('a new window starts fresh once the old one is over', () => {
  let clock = 0;
  const limiter = rateLimit({ name: 'tries', windowMs: 1000, max: 1, now: () => clock });
  assert.equal(hit(limiter).error, undefined);
  assert.equal(hit(limiter).error.status, 429);
  clock = 1000;
  assert.equal(hit(limiter).error, undefined);
});

test('each IP has its own count', () => {
  const limiter = rateLimit({ name: 'tries', windowMs: 60_000, max: 1 });
  assert.equal(hit(limiter, '198.51.100.1').error, undefined);
  assert.equal(hit(limiter, '198.51.100.1').error.status, 429);
  assert.equal(hit(limiter, '198.51.100.2').error, undefined);
});

test('login: the 11th attempt in 15 minutes is refused before the password is checked', async () => {
  const server = createApp().listen(0);
  const url = `http://localhost:${server.address().port}/auth/login`;
  const attempt = () =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ email: 'nobody@rate-limit.example.test', password: 'wrong-password' }),
    });
  try {
    for (let i = 1; i <= 10; i++) assert.equal((await attempt()).status, 401, `attempt ${i}`);

    const started = performance.now();
    const res = await attempt();
    const elapsed = performance.now() - started;
    const body = await res.json();

    assert.equal(res.status, 429);
    assert.equal(body.error.code, 'RATE_LIMITED');
    assert.ok(Number(res.headers.get('retry-after')) > 800); // ~15 minutes
    // The frontend (another origin) can read the answer and the wait time.
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.match(res.headers.get('access-control-expose-headers'), /Retry-After/);
    // Refused before bcrypt (~250 ms at cost 12) ran.
    assert.ok(elapsed < 100, `took ${elapsed} ms`);
  } finally {
    server.close();
  }
});
