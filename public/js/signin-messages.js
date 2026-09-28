/* The sign-in page's message catalogue.
   Pure functions, no DOM access, so this file can be loaded and unit tested
   directly in Node (see test/signin-messages.test.js) as well as in the
   browser as a plain script (window.SignInMessages, no modules, no build
   step — same pattern as webauthn-client.js). */

(function () {
  'use strict';

  // Fixed lines: each is announced once, unchanged, so there's exactly one
  // place to check the wording against docs/sign-in-plan.md.
  var STATES = {
    opening: 'Opening device verification.',
    checking: 'Checking sign-in.',
    success: 'You are signed in.',
    unsupported:
      'This browser cannot use passkeys, so you cannot sign in with one here. ' +
      'Try a recent version of Safari or Chrome, or use another method.',
    missingUsername:
      'Please enter your username, or use the “Sign in with a passkey” button instead.',
  };

  /**
   * Turn whatever went wrong into { message, focus }.
   *
   * `stage` says how far the attempt got before it failed:
   *   'options' — asking the server for a challenge, before the OS prompt.
   *   'prompt'  — the OS passkey prompt itself was open.
   *   'verify'  — the device answered and the server was asked to check it.
   *
   * `focus` is 'username' (the passkey button can't fix a typo) or 'retry'
   * (back to whichever button started the attempt).
   */
  function describeFailure(args) {
    var error = args.error;
    var stage = args.stage;
    var elapsedMs = args.elapsedMs;
    var timeoutMs = args.timeoutMs;

    // The server already knows the specific reason and has written it in the
    // plan's "Sign-in was not completed. <reason>. <next step>." shape, with
    // a code attached (src/errors.js) — so its message is used as-is rather
    // than re-derived here. Only a typo-shaped code sends focus back to the
    // username field; every other failure returns focus to the button that
    // started the attempt, per the plan (passkeys are the safer route).
    if (error && error.kind === 'server' && error.code) {
      var usernameCodes = { 'invalid-username': true, 'no-account': true };
      return {
        message: error.message,
        focus: usernameCodes[error.code] ? 'username' : 'retry',
      };
    }

    // Any server answer with no code is an unrecognised server-side fault,
    // not one of the named failures above — usually a 5xx, but an uncoded
    // 4xx lands here too rather than falling through to the catch-all below,
    // which would wrongly blame the user's device.
    if (error && error.kind === 'server') {
      return {
        message: "Sign-in was not completed. Something went wrong on the website's side. Try again in a moment.",
        focus: 'retry',
      };
    }

    // The two network-failure messages differ because what has actually
    // happened differs: before the prompt, nothing was sent, so nothing has
    // changed; after the device answered, the server may or may not have
    // received it, so sign-in status is genuinely unknown.
    if (error && error.kind === 'network') {
      if (stage === 'verify') {
        return {
          message:
            'Sign-in could not be confirmed because the connection was lost. You may not be signed in. Try again.',
          focus: 'retry',
        };
      }
      return {
        message:
          'Sign-in was not completed. The website could not be reached. Check your connection and try again. Nothing has changed.',
        focus: 'retry',
      };
    }

    var name = error && error.name;

    if (name === 'NotAllowedError' && stage === 'prompt') {
      // The WebAuthn spec deliberately reports "the user cancelled" and "the
      // prompt timed out" as the exact same DOMException, so there is no way
      // to ask the browser which one happened. Timing the attempt ourselves
      // is the only way left to tell them apart: if we got close to the
      // timeout we gave the browser, it almost certainly timed out.
      var closeToTimeout = elapsedMs >= timeoutMs - 10000;
      if (closeToTimeout) {
        var minutes = Math.round(timeoutMs / 60000);
        return {
          message:
            "Sign-in was not completed. Your device's request timed out after " +
            minutes +
            " minutes. Try again when you're ready.",
          focus: 'retry',
        };
      }
      return {
        message:
          'Sign-in was not completed. Device verification was closed before it finished, ' +
          'or this device has no passkey for this website. Try again or use another method.',
        focus: 'retry',
      };
    }

    if (name === 'AbortError') {
      // Fired when the in-flight request is deliberately cancelled, e.g. a
      // second sign-in attempt starting before the first one finished.
      return {
        message:
          'Sign-in was not completed. The request was stopped before it finished, for example ' +
          'because another sign-in started. Try again.',
        focus: 'retry',
      };
    }

    if (name === 'SecurityError') {
      // The page's own origin/RP ID does not qualify for WebAuthn at all —
      // no retry of the same page will help.
      return {
        message:
          "Sign-in was not completed. This page's address can't be used with passkeys. " +
          'Open the site again from the start.',
        focus: 'retry',
      };
    }

    // Anything else (ConstraintError, NotSupportedError, InvalidStateError,
    // an unexpected exception): one honest catch-all rather than guessing.
    return {
      message:
        'Sign-in was not completed. Your device could not finish the passkey request. ' +
        'Try again, or use another method.',
      focus: 'retry',
    };
  }

  window.SignInMessages = {
    STATES: STATES,
    describeFailure: describeFailure,
  };
})();
