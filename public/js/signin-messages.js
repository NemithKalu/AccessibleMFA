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
    intro: 'Use your passkey to sign in. Your device will ask you to verify.',
    opening: 'Opening device verification.',
    checking: 'Checking sign-in.',
    success: 'You are signed in.',
    unsupported:
      'This browser cannot use passkeys, so you cannot sign in with one here. ' +
      'Try a recent version of Safari or Chrome, or use another method.',
    missingUsername:
      'Please enter your username, or use the “Sign in with a passkey” button instead.',
  };

  // The spoken lines for a client-side failure (no server error code). Text
  // is identical to what describeFailure below shows in the status region —
  // speech never says anything the screen does not also say in writing.
  var CLIENT_FAILURE_LINES = {
    'server-fault':
      "Sign-in was not completed. Something went wrong on the website's side. Try again in a moment.",
    'network-options':
      'Sign-in was not completed. The website could not be reached. Check your connection and try again. ' +
      'Nothing has changed.',
    'network-verify':
      'Sign-in could not be confirmed because the connection was lost. You may not be signed in. Try again.',
    // The plan's device prompt timeout is fixed at 5 minutes (PASSKEY_PROMPT_TIMEOUT_MS
    // in src/config.js), so this fixed line names it directly rather than
    // trying to hand speech a number built at runtime.
    'timed-out':
      "Sign-in was not completed. Your device's request timed out after 5 minutes. Try again when you're ready.",
    closed:
      'Sign-in was not completed. Device verification was closed before it finished, ' +
      'or this device has no passkey for this website. Try again or use another method.',
    aborted:
      'Sign-in was not completed. The request was stopped before it finished, for example ' +
      'because another sign-in started. Try again.',
    security:
      "Sign-in was not completed. This page's address can't be used with passkeys. " +
      'Open the site again from the start.',
    'device-failed':
      'Sign-in was not completed. Your device could not finish the passkey request. ' +
      'Try again, or use another method.',
  };

  // The spoken line for every server error `code` the sign-in path can
  // return (src/routes/webauthn.js and src/challenge.js). Copied word for
  // word from the server's message, with one exception: `no-account`. That
  // server message names the username the visitor typed, and speech must
  // never say a username out loud (privacy with speakers nearby), so its
  // spoken line is reworded instead. A drift check in
  // test/signin-messages.test.js keeps every other line matching the server
  // wording automatically.
  var SERVER_CODE_LINES = {
    'invalid-username':
      'Sign-in was not completed. Usernames are 3 to 32 characters: letters, numbers, dots, ' +
      'dashes or underscores. Check what you typed and try again.',
    'no-account':
      'Sign-in was not completed. There is no account with the username you typed. ' +
      'Check the spelling, or create an account.',
    'no-usable-passkeys':
      'Sign-in was not completed. That account has no passkeys that can be used. Use another method.',
    'request-expired': 'Sign-in was not completed. The request expired or was already used. Try again.',
    'request-mismatch':
      'Sign-in was not completed. The request did not match what was asked for. Try again.',
    'unknown-passkey':
      "Sign-in was not completed. This passkey isn't registered with this website. " +
      'Try a different passkey, or use another method.',
    'passkey-turned-off':
      'Sign-in was not completed. This passkey was turned off for your account. ' +
      'Use a different passkey, or use another method.',
    'account-mismatch':
      'Sign-in was not completed. This passkey belongs to a different account than the one it named. ' +
      'Try again.',
    'not-verified':
      'Sign-in was not completed. Your device did not confirm it was you with your fingerprint, ' +
      'face or PIN. Try again and complete that check.',
    'not-present':
      'Sign-in was not completed. Your device did not register a touch or a button press. Try again.',
    'possible-copy':
      'Sign-in was not completed. This passkey may have been copied, so it was refused to protect you. ' +
      'Use a different passkey.',
    'wrong-origin':
      'Sign-in was not completed. The request came from the wrong web address, so it was refused. ' +
      'Open the site again from the start.',
    'wrong-site':
      'Sign-in was not completed. This passkey belongs to a different website, so it cannot be used here.',
    'not-verified-other':
      'Sign-in was not completed. This passkey could not be verified. Try again, or use another method.',
  };

  /**
   * The only way into speech: a key from this fixed catalogue, never free
   * text. This is deliberate, and the point to make in the viva — the speak
   * function (voice-guidance.js) takes a `key`, not a message string, so it
   * is structurally impossible to hand it a username, a recovery code or a
   * PIN. Anything not in STATES, CLIENT_FAILURE_LINES or SERVER_CODE_LINES
   * returns null and is never spoken.
   */
  function spokenLine(key) {
    if (Object.prototype.hasOwnProperty.call(STATES, key)) return STATES[key];
    if (Object.prototype.hasOwnProperty.call(CLIENT_FAILURE_LINES, key)) return CLIENT_FAILURE_LINES[key];
    if (Object.prototype.hasOwnProperty.call(SERVER_CODE_LINES, key)) return SERVER_CODE_LINES[key];
    return null;
  }

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
        // The server's own code doubles as the speech key: spokenLine(code)
        // holds the fixed line for it (see signin-messages.js above).
        key: error.code,
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
        key: 'server-fault',
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
          key: 'network-verify',
        };
      }
      return {
        message:
          'Sign-in was not completed. The website could not be reached. Check your connection and try again. Nothing has changed.',
        focus: 'retry',
        key: 'network-options',
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
          key: 'timed-out',
        };
      }
      return {
        message:
          'Sign-in was not completed. Device verification was closed before it finished, ' +
          'or this device has no passkey for this website. Try again or use another method.',
        focus: 'retry',
        key: 'closed',
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
        key: 'aborted',
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
        key: 'security',
      };
    }

    // Anything else (ConstraintError, NotSupportedError, InvalidStateError,
    // an unexpected exception): one honest catch-all rather than guessing.
    return {
      message:
        'Sign-in was not completed. Your device could not finish the passkey request. ' +
        'Try again, or use another method.',
      focus: 'retry',
      key: 'device-failed',
    };
  }

  window.SignInMessages = {
    STATES: STATES,
    describeFailure: describeFailure,
    spokenLine: spokenLine,
  };
})();
