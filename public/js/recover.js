/* The recovery pages: focus on arrival, and registering the replacement
   passkey once the waiting period has finished. */

(function () {
  'use strict';

  var app = window.AccessibleMFA;

  // Arriving with something to read — a rejected code, or the current state of
  // a replacement request. Start the screen reader at the heading.
  var heading = document.querySelector('h1[data-autofocus]');
  if (heading) heading.focus();

  var form = document.getElementById('replace-form');
  var submit = document.getElementById('submit');
  if (!form) return;

  if (!app.supported()) {
    app.announce('This browser cannot create a passkey.', 'error');
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

      var result = await app.postJSON('/webauthn/register/verify', attestation);

      app.announce(
        'Success. Your new passkey is registered and your old passkeys have been turned off. Taking you to your account.',
        'success',
      );
      app.goToNextPage(result.next);
    } catch (error) {
      app.setBusy(submit, false);
      app.announce(app.describeWebAuthnError(error, 'register'), 'error', true);
    }
  });
})();
