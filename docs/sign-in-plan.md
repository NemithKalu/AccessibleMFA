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

Files: `public/css/style.css`, new `test/contrast.test.js`.

Every colour in the stylesheet was moved into a named custom property on
`:root` (`--panel`, `--panel-soft`, `--success`, `--success-bg`, `--error`,
`--error-bg`, and a new `--control-border`), so there is one place to check
and one place to fix. No hex value appears anywhere else in the file.

**Automated contrast audit.** `test/contrast.test.js` reads `style.css`,
parses the `:root` custom properties, and computes the WCAG contrast ratio
(relative luminance with sRGB linearisation) for every colour pair actually
used on a page, found by reading the templates rather than guessed. It runs
as part of `npm test`, so a future colour change that breaks contrast fails
the build instead of shipping. Measured ratios, from the test:

| Pair | What it is | Minimum | Measured | Pass |
|---|---|---|---|---|
| `--ink` on `--paper` | body text on the page | 4.5:1 | 17.63:1 | yes |
| `--muted` on `--paper` | hint text on the page | 4.5:1 | 8.68:1 | yes |
| `--accent` on `--paper` | link text on the page | 4.5:1 | 8.04:1 | yes |
| `--paper` on `--accent` | button label on an accent button | 4.5:1 | 8.04:1 | yes |
| `--accent` on `--paper` | secondary button / button-link label | 4.5:1 | 8.04:1 | yes |
| `--accent` on `--paper` | busy/disabled button label | 4.5:1 | 8.04:1 | yes (was 3.11:1 at 60% opacity — see below) |
| `--paper` on `--error` | danger button label ("Turn off …") | 4.5:1 | 7.54:1 | yes |
| `--muted` on `--paper` | tag text ("Turned off", etc.) | 4.5:1 | 8.68:1 | yes |
| `--ink` on `--panel` | status text, default (info) background | 4.5:1 | 15.99:1 | yes |
| `--ink` on `--success-bg` | status text, success background | 4.5:1 | 15.78:1 | yes |
| `--ink` on `--error-bg` | status text, error background | 4.5:1 | 15.38:1 | yes |
| `--ink` on `--panel-soft` | notice text ("What happens when you sign in") | 4.5:1 | 16.71:1 | yes |
| `--accent` on `--error-bg` | link text inside the account page's warning notice | 4.5:1 | 7.01:1 | yes |
| `--paper` on `--ink` | skip link text on its dark fill | 4.5:1 | 17.63:1 | yes |
| `--control-border` on `--paper` | text field's border against the page | 3:1 | 3.51:1 | yes (was 1.84:1 with `--line` — fixed) |
| `--focus` on `--paper` | focus outline against the page | 3:1 | 5.36:1 | yes |
| `--focus` on `--error-bg` | focus outline against an error-toned notice | 3:1 | 4.67:1 | yes |
| `--accent` on `--paper` | secondary/busy button border against the page | 3:1 | 8.04:1 | yes |

**What failed and how it was fixed.**

1. `input[type="text"]`'s border used `--line` (`#b9c0c8`), about 1.84:1
   against white — below the 3:1 that 1.4.11 needs for a low-vision user to
   see where a field is. Added `--control-border` (`#818a93`, 3.51:1) and
   pointed inputs at it. `--line` is kept for purely decorative dividers and
   borders (the header/footer rules, `ul.devices li`, `.prompt-notice`) —
   1.4.11 only covers boundaries that identify a control, not decoration, and
   a comment in the stylesheet says so.
2. `button[disabled] { opacity: 0.6 }` dimmed "Waiting for your device…" on
   the register and account pages while it was the only clue something was
   happening. The sign-in page already had an outlined look for
   `button[aria-disabled="true"]` (used there instead of `disabled`, so the
   button stays focusable); `button[disabled]` was merged into the same rule,
   so both states now keep the full-contrast accent-on-paper label instead of
   dimming. The old dimmed label measured 3.11:1 (white on 60%-opacity
   accent), below the 4.5:1 minimum.
3. That outlined busy look was identical to an ordinary outlined control, so
   on the sign-in page a busy "Sign in with a passkey" looked just like "Use
   another method" beside it. Busy and disabled buttons now have a dashed
   border, which tells them apart without changing any colour.

**Reflow (1.4.10) and resize.** Added `overflow-wrap: anywhere` to `main`,
where every long unbroken string in the app can appear — a 32-character
username, the `http://localhost:3000` origin quoted in the prompt notice,
device names, and recovery codes — so none of them can force horizontal
scrolling at 320 CSS px. Checked the rest of the stylesheet by hand: no `px`
font sizes anywhere (all type is in `rem`, so 200% resize and text-spacing
(1.4.12) are unaffected) and no fixed heights other than `.status`'s
`min-height`, which only sets a floor and cannot clip growing text.

**Target size (2.5.8).** Measured in the browser, not worked out from the
CSS. Buttons, `a.button-link`, the skip link and the text fields are all well
over 24×24 CSS px. The header links ("Home", "Create an account", "Sign in")
were only 20px tall, because a bare inline link is only as tall as its text.
They would have passed through the rule's spacing exception, since nothing
else sits within 24px of them, but they are the most-used controls on every
page, so they now have vertical padding and measure 35px. Standalone links in
their own paragraph (such as "Back to signing in") are also 20px tall and
still rely on the spacing exception, which they meet.

**Checked in the browser.** Each page (`/`, `/signin`, `/signin/other`,
`/recover`, `/register` and the not-found page) was loaded into a 320px-wide
frame and into a 640px frame with the root font size at 200%, with a
32-character username in the page and in a failure message. None scrolled
sideways (`scrollWidth` equal to the viewport width in every case); the long
username wraps inside the message box.

**Meaning not by colour alone (1.4.1).** The status region already carries a
word for every tone ("Success. …", "Sign-in was not completed. …" — never a
bare colour change), and the account page's device states are shown as text
tags ("Turned off", "This device, signed in now") rather than colour coding.
Confirmed, nothing relies on colour alone; nothing changed here.

**Focus (2.4.7)** was already visible everywhere via `:focus-visible` and was
not touched, beyond checking the ring's own contrast in the table above.

**Braille.** Nothing in this step changes message wording, so the outcome
staying first on the line (done in step 2) is unaffected; confirmed by
reading through `signin-messages.js` again.

The automated test re-checks contrast on every `npm test` run. Reflow, zoom
and target size were measured in the browser as described above, but have no
automated check in `npm test`; they are part of the by-hand pass in step 6.

### Step 6: Tests

Built as planned, in three parts.

**A. The remaining sign-in failure codes.** `test/signin-messages.test.js`
already produced eight of the server's failure codes over real HTTP; six more
were added in the same style, each asserting the code, the "Sign-in was not
completed." prefix, and (as before) the spokenLine drift check:

- `unknown-passkey` — a fresh, never-registered `SoftwareAuthenticator`
  answers a real challenge.
- `wrong-origin` — a registered authenticator signs with
  `origin: 'http://evil.example'`. Confirmed against
  `verifyAuthenticationResponse`'s own source: it checks the client data's
  origin before it ever looks at the RP ID, so this really does exercise the
  origin check and nothing else.
- `wrong-site` — the same authenticator instead signs with
  `rpId: 'evil.example'`, which corrupts the RP ID hash baked into the signed
  authenticator data while the origin stays correct. The library's own
  "Unexpected RP ID hash" error is what fires, and
  `translateVerificationError`'s `/RP ID/i` test is what turns that into
  `wrong-site` — checked against the real library behaviour, not assumed.
- `request-mismatch` — a client asks for **registration** options (leaving a
  `register` challenge on the session), then posts straight to
  `/webauthn/auth/verify`. `consumeChallenge` rejects the purpose mismatch
  before the body is even read.
- `not-present` — `test/authenticator.js`'s `SoftwareAuthenticator.authenticate`
  (and its `flags()` helper) gained an opt-in `userPresent` parameter,
  defaulting to `true` so every existing test is unaffected. Setting it to
  `false` produces the one combination a real authenticator would never send
  (verified but not present) — exactly what is needed to reach the server's
  own not-present check on purpose, without weakening what a real
  authenticator can produce.

`not-verified-other` is the library's catch-all for a verification failure
that matches none of `translateVerificationError`'s regexes. Every failure
`@simplewebauthn/server` can actually raise is already covered by the codes
above (user verification, user presence, counter, challenge, origin, RP ID),
so there is no genuine library failure left that reaches it — it is
deliberately left untested rather than faked.

**B. `test/semantics.test.js` — structure, on every page.** Twelve rules
(one `<html lang="en">`, a single `<h1>`, no skipped heading levels, the skip
link as the page's first focusable element plus a `#main` target, every input
labelled, every button with real text, no dangling `aria-describedby` /
`aria-labelledby` / `label for`, no duplicate id, no positive `tabindex`,
every link with real text, and a `#status` live region on any page that loads
a `/js/` script) are checked with plain string/regex parsing — no new
dependency — against twelve rendered pages: the six anonymous pages
(`/`, `/signin`, `/signin/other`, `/recover`, `/register`, a 404), four pages
behind a full session (`/account`, `/recovery-codes` before and just after
generating a set, `/activity`), and two behind a restricted recovery session
(`/recover/status`, `/account`). Each rule is its own `it()` per page — 144
checks in total — generated in a loop so a failure names the exact page and
rule. `<script>` bodies and HTML comments are stripped before eleven of the
twelve checks run (several of this app's own comments contain the literal
text `aria-live="polite"` as commentary); the twelfth, which has to see which
scripts a page loads, strips only the comments.

One genuine gap turned up: `/recover`'s form is a plain full-page POST, and
its template had never gained the `#status` live region that every other
scripted page carries, even though it shares `recover.js` with
`/recover/status`, which does write to it. `views/recover.ejs` now includes
`partials/status` like the others, so the shared script always has somewhere
safe to announce if it is ever asked to. Nothing else the checks found needed
a template change.

**C. By hand.** `docs/testing/sign-in-test-log.md` is the script and results
log the automated checks cannot replace: the OS passkey prompt, real focus
movement, what VoiceOver actually says, speech timing, zoom. It declares the
test setup (Safari, VoiceOver, Touch ID; Chrome's virtual authenticator only
for the user-verification-off case), a "before you start" setup, 19 numbered
test cases (successful sign-in with and without typing, cancelling, the
5-minute timeout, user verification off, an unknown or empty username, the
server stopped before and during the prompt, "Use another method" carrying
the username, reading/replaying/stopping guidance, keyboard-only navigation,
the VoiceOver headings rotor, 400% zoom, 200% text, and an optional braille
check), a results log, and a participant-feedback template.

The log's first entry, run 1, is a scripted check in headless Chromium: the
passkey prompt, network failures and speech were replaced in the page by
stand-ins, and each case's message, focus position, busy state and spoken
lines were read back. Cases 3, 6–9, 13, 14, 17 and 18 passed; 10, 12 and 15
were only partly covered. It is recorded as what it is, not as a usability
test: no screen reader ran, and Touch ID, VoiceOver and Safari still need a
by-hand run. It states plainly, matching the individual
document's own point about validation, that a script followed by the person
who wrote the code is not evidence of validated accessibility, and that no
testing with blind or low-vision participants has happened yet.

`npm test` now runs 272 tests across 37 suites, all passing.

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
