// Central configuration. Phase 1 runs entirely on localhost, which browsers
// treat as a secure origin, so WebAuthn works without TLS.

export const PORT = Number(process.env.PORT ?? 3000);

// Shown to the user by their own device during the passkey prompt.
export const RP_NAME = 'Accessible MFA demo';

// The Relying Party ID is the domain the credential is bound to. A credential
// registered for one RP ID can never be used by another — this is what makes
// passkeys phishing-resistant, so it must match the site's real hostname.
export const RP_ID = 'localhost';

// The full origin, checked on every response. RP ID alone does not pin the
// scheme or port, so we verify the origin separately.
export const ORIGIN = `http://${RP_ID}:${PORT}`;

// How long the device's passkey prompt stays open for.
//
// @simplewebauthn/server's own default is 60 seconds, which is not enough time
// for someone navigating the operating system's prompt with a screen reader.
// The page itself cannot warn as the limit approaches — the OS prompt has
// exclusive focus while it is open — so the limit has to be generous up front
// instead (WCAG 2.2.1; plan decision 5).
export const PASSKEY_PROMPT_TIMEOUT_MS = 5 * 60 * 1000;

// How long a challenge stays valid. It must outlast the device prompt above —
// otherwise the challenge could expire while the user is still mid-prompt —
// so it is the prompt timeout plus a minute of slack. It is still single use:
// this only bounds how long an *unused* challenge is allowed to sit around.
export const CHALLENGE_TTL_MS = PASSKEY_PROMPT_TIMEOUT_MS + 60 * 1000;

// Dev-only default. A real deployment would require this to be set.
export const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-only-insecure-session-secret';

// How long a passkey replacement request has to wait before it can be used.
//
// This delay is the whole defence for the recovery route: someone who steals
// a recovery code cannot use it immediately, and the real owner is told and
// has a day to cancel. Overridable so the demo and the tests do not have to
// wait 24 hours.
export const RECOVERY_WAIT_MS = Number(
  process.env.AMFA_RECOVERY_WAIT_MS ?? 24 * 60 * 60 * 1000,
);
