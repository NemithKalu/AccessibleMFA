// Challenge handling. Challenges live on the session rather than in a table:
// they are short-lived, belong to one browser, and must not outlive one attempt.

import { randomBytes } from 'node:crypto';
import { CHALLENGE_TTL_MS } from './config.js';
import { AuthError } from './errors.js';

/**
 * Create a fresh, random challenge and stash it on the session.
 *
 * `purpose` is 'register' or 'authenticate'; `data` carries whatever the
 * matching verify step needs (e.g. which account is registering).
 *
 * Returns the raw bytes, because @simplewebauthn/server UTF-8 encodes a
 * challenge passed as a string — handing it the bytes instead means the
 * base64url we remember here is byte-for-byte the one the browser is sent.
 */
export function issueChallenge(req, purpose, data = {}) {
  const bytes = randomBytes(32);
  req.session.challenge = {
    value: bytes.toString('base64url'),
    purpose,
    data,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  };
  return bytes;
}

/**
 * Read the pending challenge and immediately delete it.
 *
 * The delete happens BEFORE any validation and before the signature is
 * verified. That ordering is what makes a challenge single-use: a replayed or
 * retried response finds nothing left to match against, so it cannot succeed
 * twice even if the original response was captured.
 */
export function consumeChallenge(req, purpose) {
  // `purpose` is what the caller expects to find — 'register' or
  // 'authenticate' — which also tells us which route called this, and so
  // which wording applies. The sign-in ('authenticate') wording follows the
  // plan's "Sign-in was not completed. <reason>. <next step>." pattern and
  // carries a code; registration's wording is unchanged from before.
  const authenticate = purpose === 'authenticate';
  const challenge = req.session.challenge;
  delete req.session.challenge;

  if (!challenge) {
    throw authenticate
      ? new AuthError(
          'Sign-in was not completed. The request expired or was already used. Try again.',
          400,
          'request-expired',
        )
      : new AuthError('That request has expired or was already used. Please start again.');
  }
  if (challenge.purpose !== purpose) {
    // A registration response must not be accepted where a sign-in was asked
    // for, or vice versa.
    throw authenticate
      ? new AuthError(
          'Sign-in was not completed. The request did not match what was asked for. Try again.',
          400,
          'request-mismatch',
        )
      : new AuthError('That request did not match what was asked for. Please start again.');
  }
  if (Date.now() > challenge.expiresAt) {
    // From the user's point of view an expired challenge and a missing
    // (already-used) one are the same situation, so sign-in uses the same
    // "expired or was already used" wording and code for both.
    throw authenticate
      ? new AuthError(
          'Sign-in was not completed. The request expired or was already used. Try again.',
          400,
          'request-expired',
        )
      : new AuthError('The request timed out. Please try again.');
  }
  return challenge;
}
