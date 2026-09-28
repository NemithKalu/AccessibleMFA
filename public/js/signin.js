/* Signing in: with a username, or with no typing at all.

   States, following docs/sign-in-plan.md step 2:
   Ready -> Opening device verification -> Checking sign-in ->
   Signed in / Not completed / Could not be confirmed.
   Each state is announced exactly once, via window.SignInMessages so the
   wording lives in one place that can be unit tested on its own. */

(function () {
  'use strict';

  var app = window.AccessibleMFA;
  var messages = window.SignInMessages;
  var form = document.getElementById('signin-form');
  var submit = document.getElementById('submit');
  var passkeyButton = document.getElementById('passkey-button');
  var usernameInput = document.getElementById('username');

  // Arrived here because something happened (a passkey was revoked, say)
  // rather than by choice: start the screen reader on the explanation.
  var heading = document.querySelector('h1[data-autofocus]');
  if (heading) heading.focus();

  if (!form) return;

  function announceUnsupported() {
    app.announce(messages.STATES.unsupported, 'error');
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
    passkeyButton.addEventListener('click', announceUnsupported);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      announceUnsupported();
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
      var options = await app.postJSON('/webauthn/auth/options', { username: username });

      stage = 'prompt';
      timeoutMs = options.timeout;
      startedAt = Date.now(); // browsers report cancel and timeout the same
      // way, so timing the attempt is the only way to tell them apart later.
      var assertion = await window.SimpleWebAuthnBrowser.startAuthentication({
        optionsJSON: options,
      });

      stage = 'verify';
      app.announce(messages.STATES.checking, 'info');
      var result = await app.postJSON('/webauthn/auth/verify', assertion);

      busy = false;
      app.markBusy(button, false);
      app.announce(messages.STATES.success, 'success');
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
    }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy) return;

    var username = usernameInput.value.trim();
    if (!username) {
      usernameInput.focus();
      app.announce(messages.STATES.missingUsername, 'error');
      return;
    }
    signIn(username, submit);
  });

  passkeyButton.addEventListener('click', function () {
    if (busy) return;
    signIn('', passkeyButton);
  });
})();
