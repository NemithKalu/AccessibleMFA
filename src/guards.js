// Route guards.

import { AuthError } from './errors.js';
import { findCredentialById, findUserById } from './db.js';

/** Any signed-in user, including (later) a restricted fallback session. */
export function requireSession(req, res, next) {
  if (!req.session.userId) return res.redirect('/signin');
  const user = findUserById(req.session.userId);
  if (!user) {
    // Account vanished underneath the session (e.g. database reset).
    return req.session.destroy(() => res.redirect('/signin'));
  }
  // Revocation hook: if the passkey this session was created with has since
  // been turned off, the session dies with it. That is what makes "revoke the
  // device I lost" actually throw the thief out, rather than only stopping
  // the next sign-in.
  if (req.session.credentialId) {
    const credential = findCredentialById(req.session.credentialId);
    if (!credential || credential.status !== 'active') {
      return req.session.destroy(() => res.redirect('/signin?from=revoked'));
    }
  }

  res.locals.user = user;
  next();
}

/**
 * A FULL session — one established by a passkey assertion with user
 * verification. Phase 2 adds restricted fallback sessions (recovery code or
 * trusted-phone code), which may browse normally but must never change
 * credentials, recovery details or registered devices. Every route that
 * touches those is guarded here so that rule holds the moment those sessions
 * exist.
 */
export function requireFullSession(req, res, next) {
  if (!req.session.userId || req.session.level !== 'full') {
    throw new AuthError(
      'This action needs a full sign-in with your passkey. Please sign in again.',
      403,
    );
  }
  // Load the user as requireSession would, so routes behind this guard can
  // rely on res.locals.user whichever guard they were mounted with.
  requireSession(req, res, next);
}
