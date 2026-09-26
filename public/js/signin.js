/* Signing in: with a username, or with no typing at all. */

(function () {
  'use strict';

  var app = window.AccessibleMFA;
  var form = document.getElementById('signin-form');
  var submit = document.getElementById('submit');
  var passkeyButton = document.getElementById('passkey-button');
  var usernameInput = document.getElementById('username');

  if (!form) return;

  if (!app.supported()) {
    app.announce(
      'This browser cannot use passkeys, so you cannot sign in here. Try a recent version of Safari, Chrome, Edge or Firefox.',
      'error',
    );
    submit.disabled = true;
    passkeyButton.disabled = true;
    return;
  }

  /**
   * One flow for both entry points. With no username the server sends no
   * allowCredentials list, so the authenticator offers whichever accounts it
   * holds for this site — the "no typing" path.
   */
  async function signIn(username, button) {
    app.setBusy(button, true, 'Waiting for your device…');
    app.announce(
      'Your device is being asked for your passkey. Confirm with your fingerprint, face or device PIN.',
      'info',
    );

    try {
      var options = await app.postJSON('/webauthn/auth/options', { username: username });

      var assertion = await window.SimpleWebAuthnBrowser.startAuthentication({
        optionsJSON: options,
      });

      var result = await app.postJSON('/webauthn/auth/verify', assertion);

      app.announce(
        'Success. Signed in as ' + result.username + '. Taking you to your account.',
        'success',
      );
      app.goToNextPage(result.next + '?from=signedin');
    } catch (error) {
      app.setBusy(button, false);
      app.announce(app.describeWebAuthnError(error, 'authenticate'), 'error', true);
    }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var username = usernameInput.value.trim();
    if (!username) {
      app.announce(
        'Please enter your username, or use the “Sign in with a passkey” button instead.',
        'error',
        true,
      );
      usernameInput.focus();
      return;
    }
    signIn(username, submit);
  });

  passkeyButton.addEventListener('click', function () {
    signIn('', passkeyButton);
  });
})();
