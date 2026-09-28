# Sign-in by-hand test script and results log

Owner: K M N S B Kulatunga (230350D), Secure Sons.
Written: 28 September 2026, alongside docs/sign-in-plan.md step 6.

Covers the sign-in page, its failure messages, voice guidance, and low-vision
and keyboard use. It does not cover registration, recovery codes or the
trusted-phone route, which other members own.

## 1. Purpose and honesty note

`npm test` proves the things a script can prove: the page's structure, the
server's failure codes, the timeout values, the contrast ratios. It cannot
prove that a blind or low-vision person can actually sign in with this page —
that the operating system's own passkey prompt behaves sensibly with
VoiceOver running, that focus really lands where the code says it does once a
real browser is involved, that the spoken lines are not confusing to hear in
the order they arrive, or that reflow at 400% zoom is merely *possible*
rather than pleasant.

The individual design document's section 6 ("Planned validation") sets out
what this script is for: test sign-in, cancellation, retry and the
alternative-method handoff with a screen reader and a keyboard; check labels,
focus, announcements, contrast and enlarged text; seek feedback from blind
and low-vision users on whether they can complete sign-in independently and
understand it; and record the platform and the outcome of each task. It also
says plainly that the design is a specification, not evidence of a finished
implementation or of validated accessibility, and that automated checks
alone cannot establish usability. A checklist followed by the person who
wrote the code is a weak substitute for testing with the people it is meant
to serve, and this document does not pretend otherwise.

So, plainly: **this is a script and a log, not evidence of validated
accessibility.** It records what one sighted developer, going through the
motions of keyboard-only and screen-reader use, could check by hand. **No
testing with blind or low-vision participants has taken place**, unless a run
recorded in section 5 or a session recorded in section 6 says so.

## 2. Declared test configuration

Following plan decision 8. The browser is still marked open in the plan; Safari
is the recommended choice, so confirm it (or record the one used) in each run:

- **Device and OS:** a Mac running a current version of macOS.
- **Browser:** Safari, because it is the browser VoiceOver is built around
  and tested against most. A phone cannot reach `http://localhost`, and
  cross-device sign-in starts with a QR code the individual document already
  rules out as a step — so the laptop's own authenticator is the only
  passkey used for the primary run.
- **Screen reader:** VoiceOver, the OS default, so no extra software is
  needed to reproduce a run.
- **Authenticator:** Touch ID, via the laptop's own platform authenticator.
- **Chrome/Chromium's virtual authenticator (DevTools → More tools → WebAuthn)
  is used only for the one case Touch ID cannot produce by hand: a
  successful-looking assertion with user verification switched off.** Create
  a virtual authenticator there with "Supports user verification" on but
  leave "User is verified" off before triggering sign-in, and remove the
  virtual authenticator again afterwards so it does not linger for later
  runs.

**Starting fresh.** From the project root:

```
rm -f data/app.db
npm start
```

This drops every account, credential and recovery code, so test case 1
onwards is run against a clean database. There is nothing in this app to
"shorten" for testing (no 24-hour wait on the sign-in path, unlike recovery),
so no environment variables need overriding here.

**Turning VoiceOver on and off:** ⌘F5 (Command + F5). The same shortcut
toggles it back off at the end of a run. Test case 14 ("Stop guidance")
additionally needs *voice guidance* turned off, which is a button on the page
itself, not a system setting — the two are unrelated (VoiceOver reads the
page; guidance is this app's own optional narration on top of it).

## 3. Before you start

Once the server is running against a fresh database:

1. Go to `/register`, create an account with a username (e.g. `tester`), and
   let it create a passkey with Touch ID.
2. From `/account`, create recovery codes and note one down. No case below
   uses it, but it gets you back in if a run goes wrong (for example, a
   passkey turned off by mistake).
3. Sign out from the header's "Sign out" button.

You should now be looking at the site's home page, signed out, with one
account and one passkey to sign back in with.

## 4. Test cases

Messages below are copied exactly from `public/js/signin-messages.js` and the
server's own text (`src/routes/webauthn.js`, `src/challenge.js`), so a
mismatch between what is heard and what is written here is itself a finding,
not a typo to shrug off.

| ID | Steps | Expected | Requirements |
|---|---|---|---|
| 1 | On `/signin`, with nothing typed, activate **Sign in with a passkey**. Complete Touch ID. | "Opening device verification." then "Checking sign-in." then "You are signed in." Focus lands on the `/account` page's heading. No username was ever needed. | AR-07; WCAG 4.1.3 |
| 2 | Type the account's username into the username field, activate **Continue**. Complete Touch ID. | Same three messages as case 1. Focus lands on `/account`. | AR-07 |
| 3 | Activate **Sign in with a passkey**, then cancel the Touch ID / password prompt without completing it. | "Sign-in was not completed. Device verification was closed before it finished, or this device has no passkey for this website. Try again or use another method." Focus returns to "Sign in with a passkey". | AR-07; plan decision 2 |
| 4 | Activate **Sign in with a passkey**, then leave the prompt open and do nothing for just over 5 minutes. | "Sign-in was not completed. Your device's request timed out after 5 minutes. Try again when you're ready." Focus returns to "Sign in with a passkey". | AR-07, AR-08; WCAG 2.2.1 |
| 5 | In Chrome or Chromium, open DevTools → More tools → WebAuthn, enable the virtual authenticator environment, and add an authenticator that does **not** verify the user. Sign in with it. | Either outcome means the rule held and you were not signed in; record which one appeared. If the authenticator answers without user verification, the server refuses it: "Sign-in was not completed. Your device did not confirm it was you with your fingerprint, face or PIN. Try again and complete that check." If the browser refuses first, because the site requires user verification, nothing reaches the server and the page shows the case 3 message instead. The server-side refusal is also covered automatically (`not-verified` in test/signin-messages.test.js). Focus returns to "Sign in with a passkey" either way. | Core security rule (never accept without UV); AR-07 |
| 6 | Type a username that has never been registered, e.g. `nobody-here`, activate **Continue**. | "Sign-in was not completed. There is no account called “nobody-here”. Check the spelling, or create an account." Focus moves to the username field. | AR-07 |
| 7 | Leave the username field empty and activate **Continue**. | "Please enter your username, or use the “Sign in with a passkey” button instead." Focus moves to the username field. No request is sent to the server. | AR-07 |
| 8 | Stop the server (`Ctrl+C` in its terminal). On the already-loaded `/signin` page, activate **Sign in with a passkey**. | "Sign-in was not completed. The website could not be reached. Check your connection and try again. Nothing has changed." Focus returns to "Sign in with a passkey". Restart the server afterwards (`npm start`). | AR-07 |
| 9 | With the server running, activate **Sign in with a passkey**. While the Touch ID prompt is open, stop the server. Complete Touch ID anyway. Restart the server, then check whether the page ever settles. | "Sign-in could not be confirmed because the connection was lost. You may not be signed in. Try again." (the network-during-verify wording, not the options wording, since the request that failed was the verify step). Note in the results log which message actually appeared and how long it took. | AR-07 |
| 10 | On `/signin`, type a username, then activate **Use another method**. On the page that opens, activate **Go back to signing in**. | The username typed before is still in the username field on return — it was carried in the link's query string both ways, never retyped. | plan step 4, AR-10 |
| 11 | Reload `/signin` fresh (guidance not remembered from a previous visit). Activate **Read guidance**. | Nothing is spoken on page load itself. After the click: the guidance note (separate from the main status area) becomes visible and reads "Voice guidance is on: each step of signing in is also read aloud. Use your passkey to sign in. Your device will ask you to verify." The introduction is spoken once: "Use your passkey to sign in. Your device will ask you to verify." | AR-05, AR-06 |
| 12 | With guidance already on (from case 11), activate **Sign in with a passkey** and complete Touch ID. | Spoken, in order: "Opening device verification." (spoken while the sign-in request is fetched; the page waits for it to finish, for at most 2 seconds, so the prompt can open up to 2 seconds later than it otherwise would; speech is then stopped), then the Touch ID prompt opens as normal in Safari (confirming Safari did not refuse the prompt after the spoken delay — the `SPEAK_HANDOFF_BEFORE_PROMPT` case in `voice-guidance.js`), then, once answered, "Checking sign-in." spoken while the server verifies, then "You are signed in." spoken and given up to 3 seconds to finish before the account page loads. Record here whether Safari opened the prompt without complaint; if it refused, that is exactly the case decision 3's fallback exists for, and is worth writing up rather than silently working around. | AR-05, AR-06, AR-08; plan decision 3 |
| 13 | Produce any failure (e.g. case 3's cancellation), then activate **Read guidance**. | Spoken: the introduction, then the failure's own spoken line (from `SignInMessages.spokenLine`) — the same wording as the written failure message, read second, queued after the introduction rather than talked over it. This is `replay()`, and it works even though guidance was off when the failure happened. | AR-05, AR-06 |
| 14 | With guidance on and the **Stop guidance** button visible, activate it. Then reload the page. | Focus moves to **Read guidance** before the Stop button disappears (so the screen reader does not lose its place). The guidance note now reads "Voice guidance is off." and stays visible. After the reload, nothing is spoken automatically — guidance is remembered as off, and even if it had been remembered as on, page load itself never triggers speech. | AR-05, AR-06 |
| 15 | Using the keyboard alone (Tab, Shift+Tab, Enter/Space, no mouse), load `/signin`. | The very first Tab stop is the "Skip to main content" link. Tabbing onward visits the controls in a sensible order (notice text is not a stop; the passkey button, the other-method link, guidance buttons, then the username field and Continue button, follow in the order they appear on the page). Every stop shows a visible focus outline. | WCAG 2.1.1, 2.4.3, 2.4.7 |
| 16 | With VoiceOver on, open the headings rotor (VO+U, then arrow to Headings) on `/signin`. | Exactly one level-1 heading ("Sign in"), followed by level-2 headings in document order ("What happens when you sign in", "Choose how to sign in", "Sign in with your username instead"), with no level skipped. | WCAG 1.3.1, 2.4.6; automated by test/semantics.test.js's rule 3–4, this case confirms VoiceOver actually reads the same structure |
| 17 | In Safari, set the browser zoom to 400% (or resize the window to 320 CSS pixels wide, e.g. via responsive design mode). Load `/signin` with a long (32-character) username already in a failure message on screen. | No horizontal scrollbar appears; the long username and message text wrap within the page rather than being clipped or forcing sideways scrolling. | WCAG 1.4.10 |
| 18 | With the OS or browser text size set to 200%, load `/signin`. | All text is legible and none of it is clipped, overlapped, or cut off by a fixed-height container. | WCAG 1.4.4 |
| 19 (optional) | If a Braille display is available, connect it with VoiceOver and go through case 1 (successful sign-in) and case 3 (cancellation). | The braille output shows the outcome first, matching the "Sign-in was not completed. <reason>. <next step>." shape used everywhere in the app (step 2 of the plan) — the same ordering that written and spoken messages already use, so nothing about the message shape changes for braille specifically. | AR-07; plan step 2's "Braille" note |

## 5. Results log

One row per test case per run. "Result" is pass, fail, or partial (it mostly
worked, but see notes). Leave every detail in the notes column, including
anything that contradicts what section 4 predicted — a wrong prediction here
is a plan bug, not a test failure.

| Run | Date | Tester | Device / OS | Browser | Screen reader | Authenticator | Case | Result | Notes |
|---|---|---|---|---|---|---|---|---|---|
| _example_ | _2026-09-28_ | _K. Kulatunga_ | _MacBook Air, macOS 15.x_ | _Safari 18.x_ | _VoiceOver (built in)_ | _Touch ID_ | _1_ | _pass_ | _Focus landed on the "Your account" heading as expected; VoiceOver read the success message once, not twice._ |
| 1 | 2026-09-28 | Scripted (Claude Code) | MacBook, macOS | Chromium 155, headless | none | none: prompt replaced by a stand-in | 3 | pass | Stand-in prompt threw NotAllowedError. Message matched; focus back on "Sign in with a passkey"; the button was `aria-disabled` with a dashed border while busy and cleared afterwards. |
| 1 | 2026-09-28 | Scripted (Claude Code) | MacBook, macOS | Chromium 155, headless | none | none: prompt replaced by a stand-in | 6 | pass | Message matched, including the typed name; focus moved to the username field. |
| 1 | 2026-09-28 | Scripted (Claude Code) | MacBook, macOS | Chromium 155, headless | none | none: prompt replaced by a stand-in | 7 | pass | Message matched; focus moved to the username field; no request sent. |
| 1 | 2026-09-28 | Scripted (Claude Code) | MacBook, macOS | Chromium 155, headless | none | none: prompt replaced by a stand-in | 8 | pass | Stand-in made the sign-in request fail before the prompt. "…could not be reached… Nothing has changed." Focus back on the passkey button. |
| 1 | 2026-09-28 | Scripted (Claude Code) | MacBook, macOS | Chromium 155, headless | none | none: prompt replaced by a stand-in | 9 | pass | Stand-in prompt answered, then the check request failed. "Sign-in could not be confirmed because the connection was lost…" Focus back on the passkey button. |
| 1 | 2026-09-28 | Scripted (Claude Code) | MacBook, macOS | Chromium 155, headless | none | none: prompt replaced by a stand-in | 10 | partial | Only the link was checked: after typing, "Use another method" pointed at `/signin/other?username=nobody-here`. The return trip is covered by test/signin-other.test.js. |
| 1 | 2026-09-28 | Scripted (Claude Code) | MacBook, macOS | Chromium 155, headless | none | none: prompt replaced by a stand-in | 12 | partial | Speech replaced by a recorder. Spoken: "Opening device verification.", then speech stopped before the prompt, then the failure line. The real Touch ID prompt, and whether Safari opens it after the delay, were not tested. |
| 1 | 2026-09-28 | Scripted (Claude Code) | MacBook, macOS | Chromium 155, headless | none | none: prompt replaced by a stand-in | 13 | pass | Guidance was off when sign-in failed. Read guidance spoke the introduction, then the failure line; the note showed the "on" text; focus stayed on Read guidance; the main message was not overwritten. |
| 1 | 2026-09-28 | Scripted (Claude Code) | MacBook, macOS | Chromium 155, headless | none | none: prompt replaced by a stand-in | 14 | pass | Focus moved to Read guidance; the note read "Voice guidance is off."; Stop guidance hidden; stored setting "off". Nothing was spoken on page load. |
| 1 | 2026-09-28 | Scripted (Claude Code) | MacBook, macOS | Chromium 155, headless | none | none: prompt replaced by a stand-in | 15 | partial | Document order only, not real Tab presses: skip link, Home, Create an account, Sign in, Sign in with a passkey, Use another method, Read guidance, username, Continue, Create an account. Focus outlines not checked here. |
| 1 | 2026-09-28 | Scripted (Claude Code) | MacBook, macOS | Chromium 155, headless | none | none: prompt replaced by a stand-in | 17 | pass | From step 5: `/`, `/signin`, `/signin/other`, `/recover`, `/register` and the 404 page at 320px with a 32-character username: no sideways scrolling. |
| 1 | 2026-09-28 | Scripted (Claude Code) | MacBook, macOS | Chromium 155, headless | none | none: prompt replaced by a stand-in | 18 | pass | From step 5: the same pages at 200% root font size in a 640px frame: no sideways scrolling; not checked by eye for overlap. |

Run 1 is a scripted check of the page's own behaviour, not a usability test: no screen reader was running, and the passkey prompt, network failures and speech were replaced in the page by stand-ins. Cases 1, 2, 4, 5, 11, 16 and 19, and every case with VoiceOver and Touch ID in Safari, still need a by-hand run.

## 6. Participant feedback

**None recorded yet.** No session with a blind or low-vision participant has
been run. This section is the template for when one is.

**Consent and anonymity.** Before any session: explain what is being tested
(the software, never the participant), that they can stop at any point
without giving a reason, and that notes will not name them — a session code
(e.g. "P1") is used in place of a name anywhere these notes are kept or
shared. Ask before recording audio or screen output, and say plainly that
this is student coursework, not a product being shipped.

**Per-task template**, one block per task attempted (e.g. "sign in with the
passkey you set up earlier", "recover from a cancelled sign-in and try
again"):

| Field | Notes |
|---|---|
| Task | |
| Completed independently? (yes / no / with a hint) | |
| Time taken | |
| Errors or confusion observed | |
| What the participant said (their words, not a paraphrase) | |
| Anything the script above did not predict | |

**Session summary template**, filled in once per participant after all tasks:

- Session code:
- Date:
- Assistive technology the participant normally uses:
- Overall impression, in their words:
- The single thing they would change first:
