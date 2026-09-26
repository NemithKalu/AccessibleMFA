/**
 * An error whose message is safe — and specific enough — to show to the user
 * and announce in the aria-live region. Accessibility rule: every failure has
 * a reason, never just "Error".
 */
export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}
