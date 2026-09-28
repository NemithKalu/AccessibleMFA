/* Signing in: with a username, or with no typing at all.

   States, following docs/sign-in-plan.md step 2:
   Ready -> Opening device verification -> Checking sign-in ->
   Signed in / Not completed / Could not be confirmed.
   Each state is announced exactly once, via window.SignInMessages so the
   wording lives in one place that can be unit tested on its own.

   Voice guidance (step 3): optional, off by default, and additive — it only
   ever repeats what #status already says in writing. Feedback about guidance
   itself (on, off, unsupported) has its own small live region, #guidance-note
   — never #status, which may still be showing a sign-in failure the user
   hasn't finished reading. It is wired up here rather than inside
   voice-guidance.js itself, because voice-guidance.js knows nothing about
   this page's DOM (that's what keeps it testable in plain Node). */

(function () {
  'use strict';

  var app = window.AccessibleMFA;
  var messages = window.SignInMessages;
  var form = document.getElementById('signin-form');
  var submit = document.getElementById('submit');
  var passkeyButton = document.getElementById('passkey-button');
  var usernameInput = document.getElementById('username');
  /**
   * Reading `window.localStorage` can itself throw (some browsers raise a
   * SecurityError from the property getter when site data is blocked, not
   * just from getItem/setItem) — and if that happened while building the
   * options object below, it would throw before any button on this page got
   * wired up. voice-guidance.js already copes with `storage: null`.
   */
  function readLocalStorage() {
    try {
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }

  var guidance = window.VoiceGuidance.create({
    speech: window.speechSynthesis,
    Utterance: window.SpeechSynthesisUtterance,
    storage: readLocalStorage(),
    lines: messages.spokenLine,
  });
  var HANDOFF_MAX_MS = window.VoiceGuidance.HANDOFF_MAX_MS;
  var SUCCESS_MAX_MS = window.VoiceGuidance.SUCCESS_MAX_MS;
  var SPEAK_HANDOFF_BEFORE_PROMPT = window.VoiceGuidance.SPEAK_HANDOFF_BEFORE_PROMPT;

  var readGuidanceButton = document.getElementById('read-guidance');
  var stopGuidanceButton = document.getElementById('stop-guidance');
  var guidanceNote = document.getElementById('guidance-note');

  var GUIDANCE_ON_TEXT =
    'Voice guidance is on: each step of signing in is also read aloud. Use your ' +
    'passkey to sign in. Your device will ask you to verify.';
  var GUIDANCE_OFF_TEXT = 'Voice guidance is off.';
  var GUIDANCE_UNSUPPORTED_TEXT =
    'This browser cannot read guidance aloud. Each step is still shown in writing on this page.';

  /**
   * The guidance note is its own small polite live region, separate from
   * #status. Feedback about guidance itself (turned on, turned off, cannot
   * speak) must never land in #status: that region may still be showing a
   * sign-in failure the user hasn't finished reading, and overwriting it
   * would erase exactly the message they need. Cleared then set on the next
   * tick, like app.announce, so the change is actually announced rather than
   * silently replacing text that may already match.
   */
  function setGuidanceNote(text) {
    if (!guidanceNote) return;
    guidanceNote.hidden = false;
    guidanceNote.textContent = '';
    window.setTimeout(function () {
      guidanceNote.textContent = text;
    }, 60);
  }

  // The script is running, so "Read guidance" can do its job — un-hide it
  // regardless of whether guidance is already on (remembered from a previous
  // visit) or passkeys turn out to be unsupported below.
  if (readGuidanceButton) readGuidanceButton.hidden = false;
  if (guidance.isOn()) {
    // Remembered from a previous visit: reveal the controls and the note
    // (whose markup already carries the "on" text), but never speak on page
    // load — browsers block unrequested speech, and it would be unasked-for
    // speech even where they don't. Setting hidden directly, not via
    // setGuidanceNote, avoids a live-region text-change announcement that
    // nobody asked for on a page that just loaded.
    if (stopGuidanceButton) stopGuidanceButton.hidden = false;
    if (guidanceNote) guidanceNote.hidden = false;
  }

  if (readGuidanceButton) {
    readGuidanceButton.addEventListener('click', function () {
      if (!guidance.supported()) {
        setGuidanceNote(GUIDANCE_UNSUPPORTED_TEXT);
        return;
      }
      if (!guidance.isOn()) {
        guidance.turnOn();
        if (stopGuidanceButton) stopGuidanceButton.hidden = false;
        setGuidanceNote(GUIDANCE_ON_TEXT);
      }
      // First press speaks just the introduction (there is no status yet);
      // a later press replays the introduction plus whatever was last
      // announced — even a failure that happened before guidance was ever
      // turned on. Not written into #status here; the guidance note above
      // is the introduction's written version (AR-05). Focus stays put.
      guidance.replay();
    });
  }

  if (stopGuidanceButton) {
    stopGuidanceButton.addEventListener('click', function () {
      // Move focus first: hiding a focused button drops focus to the page,
      // losing the screen reader's place.
      if (readGuidanceButton) readGuidanceButton.focus();
      guidance.turnOff();
      stopGuidanceButton.hidden = true;
      // The note itself stays visible, now showing the "off" text — it is
      // guidance's own live region, so this is where that feedback belongs.
      setGuidanceNote(GUIDANCE_OFF_TEXT);
    });
  }

  // Arrived here because something happened (a passkey was revoked, say)
  // rather than by choice: start the screen reader on the explanation.
  var heading = document.querySelector('h1[data-autofocus]');
  if (heading) heading.focus();

  if (!form) return;

  // Shown once, at load, if this browser cannot use passkeys at all — no
  // speech here, since nothing the user did asked for it (never speak on
  // page load). A later click or submit gets the spoken version too, via
  // announceUnsupportedFromInput below.
  function announceUnsupported() {
    app.announce(messages.STATES.unsupported, 'error');
  }

  function announceUnsupportedFromInput() {
    announceUnsupported();
    guidance.say('unsupported');
  }

  if (!app.supported()) {
    announceUnsupported();
    // aria-disabled, not the `disabled` attribute: the controls stay in the
    // tab order (WCAG 2.4.3), so a screen-reader user who activates one
    // anyway hears why nothing happened, instead of the control silently
    // vanishing from the page. "Use another method" is a plain link and
    // needs no handling here — it works regardless of passkey support.
    app.markBusy(passkeyButton, true);
    app.markBusy(submit, true);
    passkeyButton.addEventListener('click', announceUnsupportedFromInput);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      announceUnsupportedFromInput();
    });
    return;
  }

  // One flag guards both entry points: while a request is in flight, a
  // second click or submit is ignored rather than racing two passkey prompts.
  var busy = false;

  /**
   * One flow for both entry points. With no username the server sends no
   * allowCredentials list, so the authenticator offers whichever accounts it
   * holds for this site — the "no typing" path.
   */
  async function signIn(username, button) {
    busy = true;
    app.markBusy(button, true);
    app.announce(messages.STATES.opening, 'info');

    var stage = 'options'; // before the OS prompt
    var startedAt = null; // set once the prompt actually opens
    var timeoutMs = null;

    try {
      var options;
      if (guidance.isOn() && SPEAK_HANDOFF_BEFORE_PROMPT) {
        // Speak the handoff line while the options request is in flight, so
        // the (capped) delay overlaps the network call instead of adding to
        // it (plan decision 3).
        var results = await Promise.all([
          app.postJSON('/webauthn/auth/options', { username: username }),
          guidance.sayAndWait('opening', HANDOFF_MAX_MS),
        ]);
        options = results[0];
      } else {
        options = await app.postJSON('/webauthn/auth/options', { username: username });
      }

      stage = 'prompt';
      timeoutMs = options.timeout;
      // Always stop narration before the OS prompt opens, whether or not
      // anything was speaking — competing speech at the moment the device
      // takes over the screen would be worse than none.
      guidance.stop();
      startedAt = Date.now(); // browsers report cancel and timeout the same
      // way, so timing the attempt is the only way to tell them apart later.
      var assertion = await window.SimpleWebAuthnBrowser.startAuthentication({
        optionsJSON: options,
      });

      stage = 'verify';
      app.announce(messages.STATES.checking, 'info');
      guidance.say('checking');
      var result = await app.postJSON('/webauthn/auth/verify', assertion);

      busy = false;
      app.markBusy(button, false);
      app.announce(messages.STATES.success, 'success');
      if (guidance.isOn()) {
        // Let the success line finish (capped) before the page navigates
        // away, so it doesn't get cut off mid-sentence.
        await guidance.sayAndWait('success', SUCCESS_MAX_MS);
      }
      app.goToNextPage(result.next + '?from=signedin');
    } catch (error) {
      busy = false;
      app.markBusy(button, false);

      var outcome = messages.describeFailure({
        error: error,
        stage: stage,
        elapsedMs: startedAt === null ? 0 : Date.now() - startedAt,
        timeoutMs: timeoutMs,
      });

      // Focus moves first, so the live-region announcement queues after the
      // focus change instead of racing it — WCAG 4.1.3: a status message is
      // announced without moving focus to the message itself.
      if (outcome.focus === 'username') {
        usernameInput.focus();
      } else {
        // Passkeys are the safer route (plan decision 2), so every non-typo
        // failure sends focus back to whichever button started the attempt
        // rather than to a separate "try again" control.
        button.focus();
      }
      app.announce(outcome.message, 'error');
      guidance.say(outcome.key);
    }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy) return;

    var username = usernameInput.value.trim();
    if (!username) {
      usernameInput.focus();
      app.announce(messages.STATES.missingUsername, 'error');
      guidance.say('missingUsername');
      return;
    }
    signIn(username, submit);
  });

  passkeyButton.addEventListener('click', function () {
    if (busy) return;
    signIn('', passkeyButton);
  });
})();
