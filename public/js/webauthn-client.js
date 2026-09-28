/* Shared browser helpers. Loaded before each page's own script.
   window.SimpleWebAuthnBrowser comes from the UMD bundle in /vendor. */

(function () {
  'use strict';

  var statusEl = document.getElementById('status');

  /**
   * Put a message in the live region.
   *
   * Every message names a reason. The region is cleared first and set on the
   * next tick, because assistive technology only announces a *change* — two
   * identical messages in a row would otherwise be read once.
   */
  function announce(message, tone, moveFocus) {
    if (!statusEl) return;
    statusEl.textContent = '';
    statusEl.setAttribute('data-tone', tone || 'info');
    window.setTimeout(function () {
      statusEl.textContent = message;
      // On failure, move focus to the message so the user is standing on the
      // explanation and can tab straight back into the form below it.
      if (moveFocus) statusEl.focus();
    }, 60);
  }

  function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      button.dataset.idleLabel = button.textContent;
      button.textContent = busyLabel;
      button.disabled = true;
    } else {
      if (button.dataset.idleLabel) button.textContent = button.dataset.idleLabel;
      button.disabled = false;
    }
  }

  /**
   * Like setBusy, but for the sign-in page's buttons, which must not use the
   * `disabled` attribute: disabling a focused button makes the browser drop
   * focus to the page, losing the screen reader's place. `aria-disabled`
   * keeps the button focusable and in the tab order while still signalling
   * (and, via CSS, showing) that it will not respond to another click. The
   * label is also left untouched — changing it would fire a second,
   * unrelated announcement on top of the status message.
   */
  function markBusy(button, busy) {
    if (!button) return;
    if (busy) {
      button.setAttribute('aria-disabled', 'true');
    } else {
      button.removeAttribute('aria-disabled');
    }
  }

  /**
   * POST JSON and let the caller tell *why* it failed:
   *   - kind 'network': fetch itself rejected (offline, server not running).
   *   - kind 'server': the server answered, but with a non-2xx status. The
   *     AuthError's optional `code` (see src/errors.js) travels along on
   *     `error.code`, so callers can act on it without parsing the message.
   */
  async function postJSON(url, body) {
    var response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
    } catch (fetchError) {
      var networkError = new Error('The website could not be reached.');
      networkError.kind = 'network';
      throw networkError;
    }

    var payload = await response.json().catch(function () {
      return {};
    });
    if (!response.ok) {
      var serverError = new Error(payload.error || 'The server could not complete that request.');
      serverError.kind = 'server';
      serverError.status = response.status;
      serverError.code = payload.code;
      throw serverError;
    }
    return payload;
  }

  /**
   * Turn a WebAuthn DOMException into something worth hearing.
   * "Error" tells a blind user nothing about what to do next.
   */
  function describeWebAuthnError(error, context) {
    switch (error && error.name) {
      case 'InvalidStateError':
        return context === 'register'
          ? 'This device already has a passkey for this account. Try a different device or a security key.'
          : 'This device could not use a passkey for this account.';
      case 'NotAllowedError':
        // The spec deliberately makes cancellation and timeout look the same,
        // so the message has to cover both rather than guess.
        return 'The request was cancelled or timed out. Nothing has changed. You can try again.';
      case 'AbortError':
        return 'The request was stopped before it finished. You can try again.';
      case 'ConstraintError':
        return 'Your device could not meet the security requirements. It may not be able to check that it is you with a fingerprint, face or PIN.';
      case 'NotSupportedError':
        return 'Your device could not create a passkey of the type this site needs.';
      case 'SecurityError':
        return 'This page is not being served from an address that passkeys can be used on.';
      default:
        // A postJSON network failure surfaces here too (register.js and
        // account.js pass any caught error straight to this function), so it
        // gets a plain-language message instead of the raw "Failed to fetch".
        if (error && error.kind === 'network') {
          return 'The website could not be reached. Check your connection and try again. Nothing has changed.';
        }
        return (error && error.message) || 'The passkey request could not be completed.';
    }
  }

  function supported() {
    return Boolean(
      window.SimpleWebAuthnBrowser && window.SimpleWebAuthnBrowser.browserSupportsWebAuthn(),
    );
  }

  /** Announce the outcome, give it time to be read, then move on. */
  function goToNextPage(url, delayMs) {
    window.setTimeout(function () {
      window.location.assign(url);
    }, delayMs || 1200);
  }

  window.AccessibleMFA = {
    announce: announce,
    setBusy: setBusy,
    markBusy: markBusy,
    postJSON: postJSON,
    describeWebAuthnError: describeWebAuthnError,
    supported: supported,
    goToNextPage: goToNextPage,
  };
})();
