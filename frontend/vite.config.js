import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Content Security Policy for the BUILT site: scripts, styles and images only
// from the site itself; network requests only to the site and the API.
// It stops an injected script from loading code or sending data elsewhere.
// Added at build time only: the dev server injects an inline script (hot
// reload) that this policy would block. frame-ancestors can't go in a meta
// tag; vercel.json sends it as a header.
function contentSecurityPolicy(apiUrl) {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // React sets style="" for bar widths
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${apiUrl}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), contentSecurityPolicy(env.VITE_API_URL ?? '')],
    server: {
      port: 5173,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.js'],
      env: { VITE_API_URL: 'http://api.test' },
    },
  };
});
