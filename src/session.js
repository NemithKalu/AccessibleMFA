// Starting a signed-in session.

/**
 * `level` is either:
 *   'full'       — proved by a passkey assertion with user verification.
 *   'restricted' — proved by a fallback such as a recovery code. May browse,
 *                  but must never change credentials or recovery details.
 *
 * `credentialId` is the passkey the session was created with, remembered so
 * that revoking that passkey can also end this session. A restricted session
 * has none.
 */
export function startSession(req, { user, level, credentialId = null }) {
  return new Promise((resolve, reject) => {
    // Regenerate to defeat session fixation: an attacker who planted a session
    // ID in this browser before sign-in must not end up holding a signed-in one.
    req.session.regenerate((err) => {
      if (err) return reject(err);
      // Set inside the callback — regenerate() replaces the session object, so
      // anything written before this point is gone.
      req.session.userId = user.id;
      req.session.level = level;
      req.session.credentialId = credentialId;
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}
