# AccessibleMFA

A multi-factor authentication prototype designed for blind and low-vision
users. CS3053 group project (Secure Sons).

**Phase 1 (this code):** one Node + Express app that is both the demo website
and the authentication service — passkey registration, passkey sign-in, and
sessions.

## Running it

```sh
npm install
npm start
```

Then open <http://localhost:3000>. `localhost` counts as a secure origin, so
WebAuthn works without TLS. The SQLite database is created at `data/app.db` on
first boot; delete that file to start over.

```sh
npm test
```

## What is here

| Path | What it does |
| --- | --- |
| `server.js` | Starts the app |
| `src/app.js` | Express wiring: sessions, static files, routes, error handling |
| `src/config.js` | RP name, RP ID, origin, challenge lifetime |
| `src/db.js` | SQLite schema and queries |
| `src/challenge.js` | Issues and consumes single-use challenges |
| `src/guards.js` | `requireSession`, `requireFullSession` |
| `src/routes/webauthn.js` | The four WebAuthn endpoints — every security check lives here |
| `views/`, `public/` | Server-rendered pages, styles, and browser scripts |
| `test/` | End-to-end tests driven by a software authenticator |

## The security rules this enforces

- Only the **public** key is stored. The private key never leaves the
  authenticator.
- Every attempt uses a **fresh challenge**, deleted before verification, so it
  cannot be replayed.
- **`userVerification: 'required'`** on registration and sign-in, checked twice:
  once by the library and once explicitly. The user-verification flag is what
  makes this multi-factor rather than possession of a device alone.
- `excludeCredentials` stops one authenticator enrolling twice on an account.
- The signature counter is checked for regression, with the exception that
  synced passkeys legitimately report zero every time.
- The session is regenerated on sign-in, to defeat session fixation.

## Accessibility

Built in from the start, not retrofitted: semantic HTML, one `<h1>` per page, a
`<label>` on every input, a skip link, visible focus, and an
`aria-live="polite"` region that announces every outcome **with a specific
reason** rather than "Error". Before any passkey prompt the page says in text
which site is asking and what the device will do. There is no CAPTCHA, no QR
code and no image comparison.

## Testing it by hand

`npm test` covers the server's security checks but cannot exercise the
operating system's passkey prompt, focus order or a screen reader. For that,
use Chrome DevTools → **WebAuthn** → add a virtual authenticator. Turn *user
verification* off on the virtual authenticator to see the rejection path, and
run a pass with VoiceOver (⌘F5) to hear the announcements.

## Not built yet

Recovery (recovery codes, trusted-phone code, 24-hour waiting period,
revocation), the full accessibility audit, and splitting the auth service out
behind OIDC.
