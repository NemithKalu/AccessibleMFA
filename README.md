# AccessibleMFA

A multi-factor authentication prototype designed for blind and low-vision
users. CS3053 group project (Secure Sons).

One Node + Express app that is both the demo website and the authentication
service.

- **Phase 1** — passkey registration, passkey sign-in, sessions.
- **Phase 3** — recovery codes, device management, and replacing every passkey
  after losing your devices.

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
| `src/guards.js` | `requireSession`, `requireFullSession`, and the revocation hook |
| `src/session.js` | Starting a full or restricted session |
| `src/recovery-codes.js` | Generating and hashing recovery codes |
| `src/recovery.js` | The lost-device journey: request, wait, cancel, replace |
| `src/notify.js` | Simulated email / phone notifications (printed to the console) |
| `src/attempts.js` | Attempt limiter, so recovery codes cannot be brute forced |
| `src/routes/webauthn.js` | The four WebAuthn endpoints — every security check lives here |
| `src/routes/account.js` | Recovery codes, renaming and revoking devices |
| `src/routes/recover.js` | The recovery journey's pages and actions |
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
- Recovery codes are stored as hashes, are **single use**, and are shown
  exactly once. A new set cancels the old one.
- Revoking a passkey is enforced three times over: it is left out of
  `allowCredentials`, refused outright at sign-in (the allow list is only a
  hint the browser may ignore), and **any session created with it is ended**.
- Revoking the only passkey is refused when there are no recovery codes, so
  the button cannot become a trapdoor.
- A recovery code buys a **restricted** session only: it can browse, and it
  cannot add a passkey, revoke a device or mint new recovery codes.
- A replacement waits **24 hours**, both channels are notified, and anyone who
  can sign in may cancel. Cancellation is re-checked at the moment the new
  passkey is verified, so it wins over a race.

## Accessibility

Built in from the start, not retrofitted: semantic HTML, one `<h1>` per page, a
`<label>` on every input, a skip link, visible focus, and an
`aria-live="polite"` region that announces every outcome **with a specific
reason** rather than "Error". Before any passkey prompt the page says in text
which site is asking and what the device will do. There is no CAPTCHA, no QR
code and no image comparison.

## The recovery journey

1. Signed in, go to **Your account → Manage your recovery codes** and create a
   set. They are shown once; the server keeps only hashes.
2. Lose every device. From the sign-in page, choose **replace them with a
   recovery code**.
3. Enter the username and one code. The code is spent, a restricted session
   opens, and a 24 hour wait begins. Both notifications are printed to the
   server console.
4. During the wait the old passkeys still work. Signing in normally shows a
   banner offering to cancel, and cancelling leaves the account untouched.
5. After the wait, register a new passkey. Every older passkey is turned off
   and anything signed in with one is signed out. `/activity` shows the trail.

For a demo, shorten the wait:

```sh
AMFA_RECOVERY_WAIT_MS=30000 npm start
```

## Testing it by hand

`npm test` covers the server's security checks but cannot exercise the
operating system's passkey prompt, focus order or a screen reader. For that,
use Chrome DevTools → **WebAuthn** → add a virtual authenticator. Turn *user
verification* off on the virtual authenticator to see the rejection path, and
run a pass with VoiceOver (⌘F5) to hear the announcements.

## Not built yet

- **Passwords, email verification, trusted phone and one-time codes**
  (Phase 2). The recovery route therefore takes a recovery code as its only
  evidence. The design asks for a password alongside it, and for a
  trusted-phone route as a second way in; both need Phase 2 first.
- **Fresh reauthentication** before a sensitive action (Phase 4.3). Adding a
  passkey needs a full session today, but not a passkey check in the last few
  minutes.
- The full accessibility audit (Phase 5), and the OIDC split (Phase 7).

Email and phone delivery are **simulated** throughout: messages are printed to
the server console and nothing is sent. No simulated channel should be
described as a completed security mechanism.
