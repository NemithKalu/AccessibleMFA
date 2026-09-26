/* The account page: focus on arrival, and adding another passkey. */

(function () {
  'use strict';

  var app = window.AccessibleMFA;
  var heading = document.querySelector('h1[data-autofocus]');

  // Arriving here straight after signing in or registering: put focus on the
  // heading so a screen reader starts reading at the confirmation rather than
  // leaving the user to hunt for what just happened.
  if (heading) heading.focus();

  var form = document.getElementById('add-passkey-form');
  var submit = document.getElementById('submit');
  if (!form) return;

  if (!app.supported()) {
    app.announce('This browser cannot add a passkey.', 'error');
    submit.disabled = true;
    return;
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();

    app.setBusy(submit, true, 'Waiting for your device…');
    app.announce(
      'Your device is being asked to create a passkey. Confirm with your fingerprint, face or device PIN.',
      'info',
    );

    try {
      var options = await app.postJSON('/webauthn/register/options', {
        deviceName: document.getElementById('device-name').value,
      });

      var attestation = await window.SimpleWebAuthnBrowser.startRegistration({
        optionsJSON: options,
      });

      await app.postJSON('/webauthn/register/verify', attestation);

      app.announce('Success. The passkey was added. Updating your list.', 'success');
      app.goToNextPage('/account?from=added');
    } catch (error) {
      app.setBusy(submit, false);
      app.announce(app.describeWebAuthnError(error, 'register'), 'error', true);
    }
  });
})();
