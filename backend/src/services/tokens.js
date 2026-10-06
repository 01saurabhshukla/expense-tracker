import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';
import { env } from '../config/env.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ALGORITHM = 'HS256';

export function signAccessToken(userId) {
  return jwt.sign({}, env.JWT_ACCESS_SECRET, {
    algorithm: ALGORITHM,
    subject: userId,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

// Throws if the token is expired, tampered with, or signed some other way.
// Pinning `algorithms` stops a forged token from choosing its own algorithm
// (e.g. "none", which would skip the signature check entirely).
export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: [ALGORITHM] });
}

// 32 random bytes = 256 bits: impossible to guess, so no signature is needed.
// The database is the source of truth for whether a refresh token is valid.
export function generateRefreshToken() {
  return randomBytes(32).toString('base64url');
}

// SHA-256, not bcrypt: the token is already fully random (nothing to
// brute-force), and we need the same input to give the same hash so we can
// look it up. bcrypt adds a random salt, which would make lookup impossible.
export function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
