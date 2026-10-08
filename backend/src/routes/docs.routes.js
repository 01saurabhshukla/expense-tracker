import { Router } from 'express';
import { fileURLToPath } from 'node:url';

export const docsRouter = Router();

// The API description, written by hand next to package.json (D42).
const SPEC_PATH = fileURLToPath(new URL('../../openapi.yaml', import.meta.url));

// Swagger UI from a CDN, pinned to one version: no npm dependency, and
// nothing to build. It reads the YAML below and draws the docs.
const SWAGGER_UI = 'https://unpkg.com/swagger-ui-dist@5.17.14';

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Expense Tracker API</title>
  <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER_UI}/swagger-ui-bundle.js"></script>
  <script>
    // Works for both /docs and /docs/.
    const url = location.pathname.replace(/\\/$/, '') + '/openapi.yaml';
    SwaggerUIBundle({ url, dom_id: '#swagger-ui', persistAuthorization: true });
  </script>
</body>
</html>`;

docsRouter.get('/', (req, res) => {
  res.type('html').send(PAGE);
});

docsRouter.get('/openapi.yaml', (req, res) => {
  res.type('application/yaml').sendFile(SPEC_PATH);
});
