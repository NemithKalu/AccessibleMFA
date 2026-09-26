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

// How long a challenge stays valid. Short, because a challenge is only needed
// for the few seconds between asking the browser and the user confirming.
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;

// Dev-only default. A real deployment would require this to be set.
export const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-only-insecure-session-secret';
