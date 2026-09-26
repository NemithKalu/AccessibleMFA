# Accessible MFA — prototype

University group project (CS3053, Secure Sons). A multi-factor authentication
system designed for blind and low-vision users.

## What we are building

Phase 1 (current): one Node + Express app that acts as both the demo website and
the authentication service. Passkey registration and sign-in, with sessions.

Later phases: recovery (recovery codes, trusted-phone code, 24 h waiting period,
revocation), then an accessibility pass, then optionally splitting the auth
service out behind OIDC.

## Stack

- Node + Express, server-rendered HTML (EJS or plain templates). No SPA framework.
- SQLite via `better-sqlite3`. One file, no migrations tooling.
- `@simplewebauthn/server` and `@simplewebauthn/browser` for WebAuthn.
- `express-session` with a SQLite or memory store.
- Run on `http://localhost:3000` — a secure origin for WebAuthn, so no TLS needed.

## Core security rules (do not compromise these)

- Passkeys are **device-bound**. The private key never leaves the authenticator.
  The server stores only the public credential, credential ID, and sign counter.
- Every sign-in uses a **fresh, single-use challenge**. Verify challenge, origin,
  RP ID, signature and the **user-verification (UV) flag** on every assertion.
- `userVerification: 'required'` on both registration and authentication. The UV
  flag is what makes this multi-factor, so never accept an assertion without it.
- Use `excludeCredentials` at registration to block duplicate registration of the
  same authenticator.
- Passwords: salted adaptive hash (argon2 or bcrypt). Recovery codes: stored as
  single-use hashes, never plaintext.
- Fallback sessions are **restricted**: normal use only, and no changes to
  credentials, recovery details or registered devices.
- Never log secrets (challenges are fine; codes, passwords and recovery codes are not).

## Accessibility rules (the point of the project)

- Semantic HTML: real `<button>`, `<label>` for every input, one `<h1>` per page,
  logical heading order.
- Every status change (success, failure, timeout, cancellation) is announced via
  an `aria-live="polite"` region, with a specific reason — never just "error".
- Visible focus, logical tab order, focus moved sensibly after each action.
- No visual-only steps: no CAPTCHA, no QR-only setup, no image comparison.
- Do not auto-speak passwords, PINs, recovery codes or one-time codes.
- Before a passkey prompt, state the requesting website and device in text.

## Conventions

- Keep it simple and readable over clever. This is coursework that has to be
  explained in a viva.
- Small files, clear names, comments where a security check happens and why.
- No Docker, no build step, no TypeScript unless asked.
- `npm start` should be all that's needed to run it.

## Out of scope for now

Biometric matching (the OS does it), real SMS/voice delivery (print codes to the
console), OIDC, and any production deployment concerns.
