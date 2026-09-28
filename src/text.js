// Small shared helpers for user-supplied text.

/**
 * Trim a free-text label to something safe to store and display.
 * Templates escape on output, so this is about length and emptiness, not HTML.
 */
export function cleanLabel(raw, fallback) {
  const label = String(raw ?? '').trim().slice(0, 64);
  return label || fallback;
}

// Defined once here, shared by src/routes/webauthn.js (the real check) and
// usernameFromQuery below (deciding what is safe to echo back).
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

/**
 * Reads a username back out of a query string for pre-filling a form field.
 *
 * This value is echoed straight into an HTML attribute (a form's `value=`),
 * so only something that is already a valid username is ever reflected —
 * anything else (an attempted script tag, a stray space, the wrong length)
 * is silently dropped rather than sanitised and shown anyway.
 */
export function usernameFromQuery(raw) {
  const username = String(raw ?? '').trim().toLowerCase();
  return USERNAME_PATTERN.test(username) ? username : '';
}
