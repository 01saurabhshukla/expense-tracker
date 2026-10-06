import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';
import { pool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { createUser, findUserByEmail, findUserById } from '../db/queries/users.js';
import {
  insertRefreshToken,
  findRefreshTokenForUpdate,
  revokeRefreshToken,
  revokeFamily,
} from '../db/queries/refreshTokens.js';
import {
  signAccessToken,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
  generateRefreshToken,
  hashRefreshToken,
} from './tokens.js';

const BCRYPT_ROUNDS = 12;
const PG_UNIQUE_VIOLATION = '23505';

// Compared against when the email doesn't exist, so "unknown email" takes as
// long as "wrong password" and response time doesn't reveal which accounts exist.
const DUMMY_HASH = await bcrypt.hash(randomUUID(), BCRYPT_ROUNDS);

export async function signup({ email, name, password }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    return await createUser({ email, name, passwordHash });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw err;
  }
}

export async function login({ email, password }) {
  const user = await findUserByEmail(email);
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !passwordMatches) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }

  const { passwordHash, ...publicUser } = user;
  // A new login starts a new family.
  const refreshToken = await issueRefreshToken(pool, user.id, randomUUID());

  return {
    user: publicUser,
    accessToken: signAccessToken(user.id),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
  };
}

export async function getCurrentUser(userId) {
  const user = await findUserById(userId);
  if (!user) {
    // Valid token, but the account was deleted after it was issued.
    throw new AppError(401, 'UNAUTHENTICATED', 'Account no longer exists');
  }
  return user;
}

const REFRESH_FAILURES = {
  missing: ['UNAUTHENTICATED', 'No refresh token'],
  invalid: ['INVALID_REFRESH_TOKEN', 'Refresh token is invalid'],
  expired: ['REFRESH_TOKEN_EXPIRED', 'Session has expired, please log in again'],
  reused: ['REFRESH_TOKEN_REUSED', 'Session was revoked, please log in again'],
};

export async function refresh(rawToken) {
  if (!rawToken) throwRefreshFailure('missing');

  // The callback returns a failure instead of throwing, because throwing would
  // roll back the transaction, and in the "reused" case we need the family
  // revocation to be saved.
  const outcome = await withTransaction(async (db) => {
    const token = await findRefreshTokenForUpdate(db, hashRefreshToken(rawToken));

    if (!token) return { failure: 'invalid' };

    if (token.revokedAt) {
      // An already-used token came back: two parties hold this session.
      // We can't tell which is the attacker, so end the session for both.
      await revokeFamily(db, token.familyId);
      return { failure: 'reused' };
    }

    if (token.expiresAt <= new Date()) return { failure: 'expired' };

    await revokeRefreshToken(db, token.id);
    const refreshToken = await issueRefreshToken(db, token.userId, token.familyId);
    return { userId: token.userId, refreshToken };
  });

  if (outcome.failure) throwRefreshFailure(outcome.failure);

  return {
    accessToken: signAccessToken(outcome.userId),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: outcome.refreshToken,
  };
}

// Always succeeds: logging out with a missing or unknown token is still "logged out".
export async function logout(rawToken) {
  if (!rawToken) return;

  await withTransaction(async (db) => {
    const token = await findRefreshTokenForUpdate(db, hashRefreshToken(rawToken));
    if (token) await revokeFamily(db, token.familyId);
  });
}

async function issueRefreshToken(db, userId, familyId) {
  const refreshToken = generateRefreshToken();
  await insertRefreshToken(db, {
    userId,
    familyId,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  return refreshToken;
}

function throwRefreshFailure(kind) {
  const [code, message] = REFRESH_FAILURES[kind];
  throw new AppError(401, code, message);
}
