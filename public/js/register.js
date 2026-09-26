/* Creating a new account with a passkey. */

(function () {
  'use strict';

  var app = window.AccessibleMFA;
  var form = document.getElementById('register-form');
  var submit = document.getElementById('submit');
  var usernameInput = document.getElementById('username');

  if (!form) return;

  if (!app.supported()) {
    app.announce(
      'This browser cannot use passkeys, so an account cannot be created here. Try a recent version of Safari, Chrome, Edge or Firefox.',
      'error',
    );
    submit.disabled = true;
    return;
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();

    var username = usernameInput.value.trim();
    if (!username) {
      app.announce('Please enter a username before continuing.', 'error', true);
      usernameInput.focus();
      return;
    }

    app.setBusy(submit, true, 'Waiting for your device…');
    app.announce(
      'Your device is being asked to create a passkey. Confirm with your fingerprint, face or device PIN.',
      'info',
    );

    try {
      var options = await app.postJSON('/webauthn/register/options', {
        username: username,
        displayName: document.getElementById('display-name').value,
        deviceName: document.getElementById('device-name').value,
      });

      var attestation = await window.SimpleWebAuthnBrowser.startRegistration({
        optionsJSON: options,
      });

      var result = await app.postJSON('/webauthn/register/verify', attestation);

      app.announce(
        'Success. Your account ' + result.username +
          ' has been created and you are signed in. Taking you to your account.',
        'success',
      );
      app.goToNextPage(result.next + '?from=registered');
    } catch (error) {
      app.setBusy(submit, false);
      app.announce(app.describeWebAuthnError(error, 'register'), 'error', true);
    }
  });
})();
