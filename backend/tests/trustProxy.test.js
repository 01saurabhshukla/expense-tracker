// The client IP the app believes (req.ip), with and without a trusted proxy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Starts the app in a child process with the given TRUST_PROXY, sends one
// request with an X-Forwarded-For header, and returns the IP the request log
// line recorded (req.ip).
async function ipSeen(trustProxy, { forwardedFor = '203.0.113.7' } = {}) {
  const script = `
    const { createApp } = await import('./src/app.js');
    const { pool } = await import('./src/db/pool.js');
    const server = createApp().listen(0, async () => {
      await fetch('http://127.0.0.1:' + server.address().port + '/health', { headers: { 'x-forwarded-for': ${JSON.stringify(forwardedFor)} } });
      server.close();
      await pool.end();
    });`;
  const env = { ...process.env, TRUST_PROXY: trustProxy, NODE_ENV: 'development' };
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], { env });
  const line = stdout.split('\n').find((l) => l.includes('"path":"/health"'));
  return JSON.parse(line).ip;
}

test('no proxy (local dev): X-Forwarded-For is ignored, so it cannot be faked', async () => {
  assert.equal(await ipSeen('false'), '::ffff:127.0.0.1');
});

test('nginx on the same machine (loopback): the forwarded client IP is used', async () => {
  assert.equal(await ipSeen('loopback'), '203.0.113.7');
});

test('loopback trusts only the hop nginx added, not a chain the client sent', async () => {
  // A client sends "X-Forwarded-For: 1.2.3.4"; nginx appends the real address.
  assert.equal(await ipSeen('loopback', { forwardedFor: '1.2.3.4, 203.0.113.7' }), '203.0.113.7');
});

test('config: required in production, "true" is refused', async () => {
  const base = { PATH: process.env.PATH, DATABASE_URL: 'postgres://u:p@localhost/db', JWT_ACCESS_SECRET: 'x'.repeat(32), CORS_ORIGINS: 'https://app.example.com' };
  const load = (extra) =>
    run(process.execPath, ['--input-type=module', '-e', "await import('./src/config/env.js')"], { env: { ...base, ...extra } }).then(
      () => 'ok',
      (err) => err.stderr,
    );
  assert.match(await load({ NODE_ENV: 'production' }), /TRUST_PROXY: is required in production/);
  assert.match(await load({ TRUST_PROXY: 'true' }), /TRUST_PROXY: must be/);
  assert.equal(await load({ NODE_ENV: 'production', TRUST_PROXY: 'loopback' }), 'ok');
});
