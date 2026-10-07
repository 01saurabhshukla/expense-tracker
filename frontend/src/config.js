// Build-time configuration (Vite inlines import.meta.env.VITE_* when building).
const raw = import.meta.env.VITE_API_URL;

if (!raw) {
  throw new Error('VITE_API_URL is not set. Copy frontend/.env.example to .env.local.');
}

// "https://api.example.com/" → "https://api.example.com"
export const API_URL = raw.replace(/\/+$/, '');
