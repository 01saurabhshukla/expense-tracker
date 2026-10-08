// /docs: the Swagger UI page and the OpenAPI file, and a check that the file
// doesn't describe routes the app doesn't have.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');

let server;
let baseUrl;

before(() => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

test('GET /docs serves the Swagger UI page, no login needed', async () => {
  const res = await fetch(`${baseUrl}/docs`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /SwaggerUIBundle/);
});

test('GET /docs/openapi.yaml serves the spec', async () => {
  const res = await fetch(`${baseUrl}/docs/openapi.yaml`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/yaml/);
  assert.match(await res.text(), /^openapi: 3\.1\.0/);
});

// Reads "  /path:" and the "    get:" / "    post:" lines under it. Enough for
// this file's layout, without a YAML parser.
function documentedRoutes(yaml) {
  const routes = [];
  let path = null;
  for (const line of yaml.split('\n')) {
    const pathMatch = line.match(/^ {2}(\/\S*):$/);
    if (pathMatch) path = pathMatch[1];
    else if (/^\S/.test(line)) path = null; // left `paths:`
    const methodMatch = path && line.match(/^ {4}(get|post|patch|delete):$/);
    if (methodMatch) routes.push({ method: methodMatch[1].toUpperCase(), path });
  }
  return routes;
}

test('every documented route exists', async () => {
  const yaml = await readFile(new URL('../openapi.yaml', import.meta.url), 'utf8');
  const routes = documentedRoutes(yaml);
  assert.ok(routes.length >= 17, `found only ${routes.length} routes`);

  for (const { method, path } of routes) {
    // Without a token, real routes answer 401/400/2xx; only a missing route
    // answers NOT_FOUND. Nothing here reaches the database.
    const url = baseUrl + path.replace('{id}', '00000000-0000-0000-0000-000000000000');
    const res = await fetch(url, { method });
    const body = res.status === 404 ? await res.json() : null;
    assert.notEqual(body?.error.code, 'NOT_FOUND', `${method} ${path} is documented but has no route`);
  }
});
