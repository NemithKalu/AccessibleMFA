/**
 * An error whose message is safe — and specific enough — to show to the user
 * and announce in the aria-live region. Accessibility rule: every failure has
 * a reason, never just "Error".
 *
 * `code` is optional: a short, kebab-case string (e.g. "no-account") that lets
 * the browser script tell failures apart programmatically — which button gets
 * focus, for instance — without parsing the human-readable message. Existing
 * callers that omit it are unaffected.
 */
export class AuthError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}
