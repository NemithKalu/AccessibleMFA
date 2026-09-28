# Plan: accessible sign-in and voice guidance

Owner: K M N S B Kulatunga (230350D), Secure Sons.
Written: 28 September 2026.

Sources:

- `docs/CS3053 - Computer Security - Group Project - 230350D.pdf` (the individual
  contribution, "Accessible authentication interface and voice guidance")
- `docs/Accessible MFA group design document.pdf` (the group design)

Scope: the sign-in page before and after the device's passkey prompt, optional
voice guidance, low-vision and Braille support, and status and error messages.
Out of scope: the fallback flows themselves, OIDC and enrolment, which other
members own.

Status: step 0 is done. Dependencies are installed and the existing 37 tests
pass.

## Decisions

These settle the places where the two documents disagreed.

| # | Topic | Decision |
|---|---|---|
| 1 | Where "Use another method" leads | An "Other ways to sign in" page listing the routes that exist. The individual doc should say "trusted-phone code plus password" and drop haptic delivery. |
| 2 | "Try again" button vs focus on the passkey button | No separate "Try again" button. After a failure, focus returns to "Sign in with a passkey", because passkeys are the more secure route. |
| 3 | Speaking the handoff line vs stopping speech before the prompt | Speak "Opening device verification", wait for it to end (maximum 2 seconds), stop speech, then open the device prompt. If the browser refuses the delay, move the line into the introduction instead. |
| 4 | One general failure line vs specific reasons | As specific as possible. The target users rely on the message to know what to do next. |
| 5 | Timeouts (AR-08) | The device prompt gets 5 minutes, with a clear message if it runs out. |
| 6 | Voice setting: account or page | Off by default, turned on by "Read guidance", remembered by the browser on that device. |
| 7 | Username field | Keep it, placed below the three main controls. |
| 8 | Test setup | The laptop's own authenticator: Mac, Touch ID and VoiceOver. A phone cannot reach `http://localhost`, and cross-device sign-in starts with a QR code. |
| 9 | Device-bound vs synced passkeys | Synced passkeys are accepted. |

Open: which browser to name in the test setup. Recommended: Safari with
VoiceOver, with Chrome's virtual authenticator used only to produce failures
that are hard to trigger by hand.

## Steps

### Step 1: Page layout

File: `views/signin.ejs`.

The page reads in this order:

1. Site name
2. "Sign in" heading
3. One-line instruction
4. "What happens" notice, naming the website and the device
5. Status message area
6. The three main controls: **Sign in with a passkey**, **Use another method**,
   **Read guidance**
7. "Sign in with your username instead"
8. "Create an account"

The "Lost every device?" section moves to the new "Other ways to sign in" page.

### Step 2: Sign-in states and messages

Files: `public/js/signin.js`, `public/js/webauthn-client.js`,
`src/routes/webauthn.js`, `src/config.js`.

States, following Figure 1 of the individual document: Ready → Opening device
verification → Checking sign-in → Signed in, Not completed, or Could not be
confirmed. Each state is announced once.

Every failure follows one pattern: the outcome, then the reason, then what to do
next. Starting the same way each time helps screen-reader and Braille users.

**Waiting and success**

- "Opening device verification."
- "Checking sign-in."
- "You are signed in." Then the account page opens.

**Before the device prompt**

| Situation | Message |
|---|---|
| Browser cannot use passkeys (shown on page load, before any attempt, so it does not say "not completed") | "This browser cannot use passkeys, so you cannot sign in with one here. Try a recent version of Safari or Chrome, or use another method." |
| Unknown username | "Sign-in was not completed. There is no account called "x". Check the spelling, or create an account." |
| Account has no usable passkeys | "Sign-in was not completed. That account has no passkeys that can be used. Use another method." |
| Website cannot be reached | "Sign-in was not completed. The website could not be reached. Check your connection and try again. Nothing has changed." |
| Server fault | "Sign-in was not completed. Something went wrong on the website's side. Try again in a moment." |

**At the device prompt**

Browsers report "cancelled" and "timed out" as the same error, so the page times
each attempt to tell them apart.

| Situation | Message |
|---|---|
| Closed near the 5-minute limit | "Sign-in was not completed. Your device's request timed out after 5 minutes. Try again when you're ready." |
| Closed sooner | "Sign-in was not completed. Device verification was closed before it finished, or this device has no passkey for this website. Try again or use another method." |
| Request stopped (AbortError) | "Sign-in was not completed. The request was stopped before it finished, for example because another sign-in started. Try again." |
| Wrong web address (SecurityError) | "Sign-in was not completed. This page's address can't be used with passkeys. Open the site again from the start." |

**After the device answered**

| Situation | Message |
|---|---|
| No fingerprint, face or PIN check | "Sign-in was not completed. Your device did not confirm it was you with your fingerprint, face or PIN. Try again and complete that check." |
| Passkey not registered here | "Sign-in was not completed. This passkey isn't registered with this website. Try a different passkey, or use another method." |
| Passkey turned off | "Sign-in was not completed. This passkey was turned off for your account. Use a different passkey, or use another method." |
| Passkey for another account | "Sign-in was not completed. This passkey belongs to a different account than the one it named. Try again." |
| Possible copied passkey | "Sign-in was not completed. This passkey may have been copied, so it was refused to protect you. Use a different passkey." |
| Request expired or already used | "Sign-in was not completed. The request expired or was already used. Try again." |
| Passkey belongs to another website | "Sign-in was not completed. This passkey belongs to a different website." |
| Connection lost during the check | "Sign-in could not be confirmed because the connection was lost. You may not be signed in. Try again." |

**Focus**

- After a failure, focus returns to the button that started the attempt: "Sign
  in with a passkey", or "Continue" on the username route, so a username user
  is not sent back up the page. Following WCAG 4.1.3, the message itself is
  announced without moving focus to it.
- While waiting, the button is marked busy with `aria-disabled` rather than
  being truly disabled. Disabling a focused button makes the browser drop focus.
- Exception: username errors put focus in the username field, because the
  passkey button cannot fix a typo.

**Timeouts**

- The device prompt gets 5 minutes. The `@simplewebauthn/server` default is 60
  seconds.
- Each sign-in request stays valid for 6 minutes (currently 2), so it outlasts
  the prompt. It can still be used only once.

The friendlier network-error messages also improve the registration and "add a
passkey" pages, which share the same code. Focus behaviour changes only on the
sign-in page.

### Step 3: Voice guidance

Files: new `public/js/voice-guidance.js`, extended `public/js/signin-messages.js`,
`views/signin.ejs`, `public/js/signin.js`.

Built as designed: guidance is optional, off by default, replayable and
stoppable, and never an authentication factor — it only ever repeats what the
status region already says in writing. Nothing is ever spoken on page load,
on any path, including the "this browser cannot use passkeys" case.

- Uses the browser's built-in speech (Web Speech API), in English (en-GB). No
  library and no build step.
- `voice-guidance.js` is a plain factory, `VoiceGuidance.create({ speech,
  Utterance, storage, lines })`, with every browser object passed in rather
  than read from `window`. That is what lets it be unit tested directly in
  Node with fakes, the same pattern `signin-messages.js` already used.
- **Speech only from a fixed list (AR-06).** `signin-messages.js` gained
  `spokenLine(key)`, which maps a key to fixed spoken text or returns `null`
  for anything else — never free text. `describeFailure` now also returns a
  `key` for every branch (a server error's own `code`, or one of
  `server-fault`, `network-options`, `network-verify`, `timed-out`, `closed`,
  `aborted`, `security`, `device-failed`). This is the thing to point to in
  the viva: `guidance.say()` is only ever handed a key into this catalogue,
  so it is structurally impossible for it to speak a username, a recovery
  code or a PIN.
- **Usernames are never spoken.** Every server error code's spoken line is
  copied word for word from the server's own message, with one exception:
  `no-account` names the username the visitor typed, so its spoken line is
  reworded to "There is no account with the username you typed." instead. A
  drift check in `test/signin-messages.test.js` keeps the rest matching the
  server automatically.
- **Read guidance** speaks the introduction: "Use your passkey to sign in.
  Your device will ask you to verify." The first press turns guidance on and
  speaks just that. Later presses call `replay()`, which speaks the
  introduction and then whatever status was last announced, queued together
  without a script needing to say them in one string. That "last announced"
  status is recorded every time, whether or not guidance was on when it
  happened — a sign-in failure that occurs before guidance is ever turned on
  is exactly the case replay has to cover, since a user often turns guidance
  on *because* something just went wrong and they want it repeated.
- **Guidance feedback has its own live region, `#guidance-note`, separate
  from `#status`.** `#status` can still be showing a sign-in failure the
  user hasn't finished reading; turning guidance on or off, or finding out
  the browser can't speak, must never overwrite that message, so none of it
  is ever announced through `#status`. The note (`role="status"
  aria-live="polite"`, hidden until first needed) doubles as the written
  version of the spoken introduction (AR-05): revealing it shows "Voice
  guidance is on: …"; turning guidance off replaces its text with "Voice
  guidance is off." and leaves it visible; finding speech unsupported shows
  "This browser cannot read guidance aloud…" there instead. Its text is
  cleared and reset on the next tick, the same way `AccessibleMFA.announce`
  handles `#status`, so assistive tech actually announces the change.
- While guidance is on, a **Stop guidance** button appears next to it. It
  moves focus back to Read guidance first (hiding a focused button drops
  focus to the page), then stops speech, turns guidance off, hides itself,
  and updates the guidance note as above.
- The handoff line follows decision 3: `sayAndWait('opening', HANDOFF_MAX_MS)`
  (2 seconds) runs in parallel with the options request, so the delay
  overlaps the network call rather than adding to it, and speech is always
  stopped immediately before the passkey prompt opens — competing with the
  OS prompt would be worse than saying nothing. A `SPEAK_HANDOFF_BEFORE_PROMPT`
  switch in `voice-guidance.js` exists for the decision's fallback: if the
  chosen browser refuses to open the prompt after that delay (Safari can be
  strict about the prompt following directly from a click), flipping it to
  `false` skips speaking the handoff line before the prompt — the
  introduction has already told the user their device will ask them to
  verify.
- The success line ("You are signed in.") is given up to 3 seconds
  (`SUCCESS_MAX_MS`) to finish before the page navigates away, so it isn't cut
  off mid-sentence.
- If the browser cannot speak (`guidance.supported()` is false), Read guidance
  shows that in the guidance note (never `#status`) and does nothing else;
  the written guidance on the page works regardless.
- `window.localStorage` can itself throw on access in some browsers (not just
  its `getItem`/`setItem`), so `signin.js` reads it through a small
  try/catch and passes `null` on failure — `voice-guidance.js` already treats
  a missing `storage` as "nothing remembered", so guidance still works for
  the rest of that session.

### Step 4: "Other ways to sign in"

Files: `src/text.js`, `src/routes/pages.js`, `src/routes/recover.js`, new
`views/signin-other.ejs`, `views/signin.ejs`, `public/js/signin.js`.

Built as designed: `GET /signin/other` is reached only from "Use another
method" on the sign-in page — nothing redirects a visitor there automatically
(AR-10) — and a signed-in visitor is bounced to `/account`, the same as
`/signin`. The page has three sections, in order:

- **If your passkey is on another device or a security key** — go back and use
  "Sign in with your username instead" to pick that device or plug in the key.
  This is not a dead end; it just sends the visitor back to `/signin`, with the
  username (if any) already filled in.
- **If you have lost every device with a passkey** — use a recovery code. The
  numbered list of what happens (code spent, restricted session, 24 hour wait, anyone
  who can sign in normally can cancel it, then a new passkey and the old ones
  stop working) mirrors `views/recover.ejs`'s own explanation, shortened,
  so nobody starts a replacement thinking it is a normal sign-in.
- **If you have no recovery code** — there is no automatic way in; contact
  support.

The trusted-phone code plus password route from the group design is Phase 2
and is not built, so it is not listed — only routes that actually work are
shown. An EJS comment on the page marks where it will go once it exists.

**Carrying the username.** A username the visitor already typed is carried
over so it doesn't need retyping, but only after being checked: `src/text.js`
now exports `USERNAME_PATTERN` (moved out of `src/routes/webauthn.js`, which
imports it from there instead) and `usernameFromQuery(raw)`, which lowercases,
trims, and returns the value only if it matches the pattern — otherwise `''`.
That function is the only thing standing between the query string and an HTML
attribute, on `/signin/other` (its own `username`), `/recover` (which now
pre-fills the same way, replacing its old hard-coded `''`) and `/signin` (so
"Go back to signing in" returns with the username field already filled). Anything that
isn't already a valid username — a script tag, a stray space, the wrong
length — is silently dropped rather than sanitised and shown anyway.
`public/js/signin.js` keeps the username field's typed value in step with the
"Use another method" link's `href` on every `input` event, wired up before the
unsupported-passkeys early return so it also works on that path; without the
script the link still works, it just doesn't carry the name.

### Step 5: Low vision and Braille

File: `public/css/style.css`.

- Check that every colour pair meets 4.5:1 contrast (WCAG 1.4.3). Replace the
  60% opacity busy button, which lowers the contrast of "Waiting for your
  device…".
- Test at 200% text size (1.4.4) and 400% zoom, 320 px wide (1.4.10).
- Keep the visible focus indicator (2.4.7).
- Make targets at least 24 by 24 px (2.5.8).
- Keep the outcome at the start of every message, so it is the first thing on a
  Braille line.

### Step 6: Tests

Automated, using the existing `node:test` setup:

- The sign-in page has one heading, the controls in the specified order, and a
  status message area.
- The device prompt timeout is 5 minutes and a sign-in request outlasts it.
- Each server-side failure returns its specific message.

By hand, with keyboard only and then with VoiceOver:

- Successful sign-in
- Cancelling at the device prompt
- Letting the prompt time out
- Rejection (Chrome's virtual authenticator with user verification switched off)
- The server stopped
- "Use another method"
- Guidance turned on, turned off and replayed

A short test log template will record the device, browser, screen reader and
outcome of each run. No testing with blind or low-vision participants is
claimed unless it actually happens.

### Step 7: Documents

**Individual document**

- §3: remove "Try again". Focus returns to "Sign in with a passkey".
- §5: replace "password-plus-OTP fallback, with voice-call or haptic delivery"
  with "trusted-phone code plus password" (or recovery codes), and drop haptic.
  State the test setup: Mac, Touch ID, VoiceOver and the chosen browser.
- Add a sentence on the 5-minute prompt limit and the specific failure messages
  (AR-07, AR-08).
- Cite WCAG 1.4.4 (text resize) and 2.5.8 (target size) with the existing
  criteria.

**Group document** (for the group to change)

- Synced passkeys affect §1.2, A-07, D-01, SR-03 and the "Primary phone only"
  row in §6.3.
- Suggested wording: the private key is synced, end-to-end encrypted, through the
  platform's keychain, and the server still stores only the public key.
- Losing a phone no longer means losing the passkey, which makes the lost-phone
  recovery route less central.
- Add the cross-device QR-code limitation to §9 Risks and Limitations.

**Repository**

- `CLAUDE.md` still says "Passkeys are **device-bound**" and "Phase 1
  (current)". Update both, and tell the group when committing because it is a
  shared file.
- Update the README's accessibility section.

## Build order

Steps 1 and 2 together, then 3, 4, 5, 6 and 7. Voice guidance comes after step 2
because it speaks the messages that step creates.
