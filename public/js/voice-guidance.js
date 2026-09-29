/* Optional, replayable, stoppable spoken guidance for the sign-in page
   (docs/sign-in-plan.md, step 3). Uses the browser's built-in speech (Web
   Speech API) — no library, no build step.

   Like signin-messages.js, this is plain, dependency-injected JavaScript: the
   browser objects it needs (speechSynthesis, SpeechSynthesisUtterance,
   localStorage) are passed into create() rather than read from `window`
   directly, so this file can be loaded and exercised in plain Node with
   fakes (see test/voice-guidance.test.js) with no browser involved at all.

   Voice guidance is assistance, not an authentication factor: it only ever
   repeats what the status region already says in writing (AR-05), and it can
   speak solely lines drawn from window.SignInMessages.spokenLine's fixed
   catalogue (AR-06) — never a username, a recovery code or a PIN. */

(function () {
  'use strict';

  // Off until the user turns it on themselves, and remembered on this device
  // from then on (plan decision 6) — universal screen-reader detection isn't
  // assumed, so the choice is the user's, not a guess.
  var STORAGE_KEY = 'amfa.voiceGuidance';

  // Plan decision 3: speak "Opening device verification", wait up to this
  // long for it to finish, then stop speech and open the device prompt
  // regardless. The utterance's 'end' event does not fire reliably in every
  // browser, so this cap — not 'end' — is what actually guarantees the
  // handoff line never delays the prompt for long.
  var HANDOFF_MAX_MS = 2000;

  // Same idea for "You are signed in.": give it up to this long before moving
  // on to the next page, so navigating away doesn't cut the line off.
  var SUCCESS_MAX_MS = 3000;

  // If the chosen browser refuses to open the passkey prompt after the
  // handoff delay above (Safari is strict about the prompt following
  // directly from a user click), set this to false: the handoff line is then
  // not spoken before the prompt opens, and the introduction already tells
  // the user the device will ask them to verify (plan decision 3 fallback).
  var SPEAK_HANDOFF_BEFORE_PROMPT = true;

  /**
   * Build a guidance object.
   *
   *   speech    - window.speechSynthesis (may be undefined: not every
   *               browser implements the Web Speech API)
   *   Utterance - window.SpeechSynthesisUtterance (may be undefined)
   *   storage   - window.localStorage (its getItem/setItem may throw, e.g.
   *               in some private-browsing modes — every access is wrapped)
   *   lines     - window.SignInMessages.spokenLine
   */
  function create(options) {
    var speech = options.speech;
    var Utterance = options.Utterance;
    var storage = options.storage;
    var lines = options.lines;

    var on = readStoredOn();
    // The last status key recorded (never 'intro' itself), so replay() can
    // repeat "introduction, then whatever we most recently told you" — even
    // when that status was announced while guidance was off.
    var lastKey = null;

    function readStoredOn() {
      try {
        return Boolean(storage) && storage.getItem(STORAGE_KEY) === 'on';
      } catch (e) {
        return false; // no memory of a previous choice; off by default
      }
    }

    function writeStoredOn(value) {
      try {
        if (storage) storage.setItem(STORAGE_KEY, value ? 'on' : 'off');
      } catch (e) {
        // Storage isn't available right now (private browsing, quota, etc).
        // Guidance still works for the rest of this page load; it just won't
        // be remembered next time.
      }
    }

    function supported() {
      return Boolean(speech && Utterance);
    }

    function isOn() {
      return on;
    }

    function turnOn() {
      on = true;
      writeStoredOn(true);
    }

    function turnOff() {
      on = false;
      writeStoredOn(false);
      stop();
    }

    function stop() {
      if (speech) speech.cancel();
    }

    /**
     * Remember `key` as the latest status, so replay() can repeat it later —
     * regardless of whether guidance is currently on, or speech is even
     * supported. A failure that happened while guidance was off (or before
     * "Read guidance" was ever pressed) is exactly the case replay() exists
     * for: the user turns guidance on *because* something just went wrong,
     * and still needs to hear what. 'intro' itself is never remembered this
     * way, and neither is a key with no fixed line.
     */
    function remember(key, text) {
      if (key !== 'intro' && text !== null && text !== undefined) lastKey = key;
    }

    /**
     * Speak `key` without cancelling first (used by replay() to queue two
     * lines back to back) or checking `on`/supported() (the caller already
     * has). Does nothing for a key with no fixed line.
     */
    function queue(key) {
      var text = lines(key);
      if (text === null || text === undefined) return;
      var utterance = new Utterance(text);
      utterance.lang = 'en-GB';
      speech.speak(utterance);
    }

    function say(key) {
      var text = lines(key);
      remember(key, text);
      if (!on || !supported()) return;
      // Checked before cancelling: an unknown key must not interrupt speech
      // that is already under way.
      if (text === null || text === undefined) return;
      speech.cancel(); // never two voices at once
      queue(key);
    }

    function sayAndWait(key, maxMs) {
      return new Promise(function (resolve) {
        var text = lines(key);
        remember(key, text);
        if (!on || !supported()) {
          resolve();
          return;
        }
        if (text === null || text === undefined) {
          resolve();
          return;
        }

        speech.cancel();
        var utterance = new Utterance(text);
        utterance.lang = 'en-GB';

        var settled = false;
        function finish() {
          if (settled) return;
          settled = true;
          resolve();
        }
        // 'end' does not fire reliably in every browser, so this timeout is
        // what actually guarantees the promise settles.
        utterance.onend = finish;
        utterance.onerror = finish;
        setTimeout(finish, maxMs);

        speech.speak(utterance);
      });
    }

    function replay() {
      if (!on || !supported()) return;
      // Queue both without cancelling in between: calling speak() twice in a
      // row queues the second utterance after the first, so the intro is
      // always heard in full before the status line that follows it.
      speech.cancel();
      queue('intro');
      if (lastKey) queue(lastKey);
    }

    return {
      supported: supported,
      isOn: isOn,
      turnOn: turnOn,
      turnOff: turnOff,
      say: say,
      sayAndWait: sayAndWait,
      stop: stop,
      replay: replay,
    };
  }

  window.VoiceGuidance = {
    create: create,
    HANDOFF_MAX_MS: HANDOFF_MAX_MS,
    SUCCESS_MAX_MS: SUCCESS_MAX_MS,
    SPEAK_HANDOFF_BEFORE_PROMPT: SPEAK_HANDOFF_BEFORE_PROMPT,
  };
})();
