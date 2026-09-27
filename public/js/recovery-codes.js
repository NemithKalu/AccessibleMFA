/* The recovery codes page: focus on arrival, and the download button.

   The download is built in the browser from the list already on screen. The
   server only ever stored hashes, so it could not offer this file itself. */

(function () {
  'use strict';

  var heading = document.querySelector('h1[data-autofocus]');
  if (heading) heading.focus();

  var button = document.getElementById('download');
  var list = document.querySelector('ol.codes');
  if (!button || !list) return;

  button.addEventListener('click', function () {
    var codes = Array.prototype.map.call(list.querySelectorAll('code'), function (el) {
      return el.textContent.trim();
    });

    var text =
      'Accessible MFA demo — recovery codes\r\n' +
      'Each code can be used once. Keep this file somewhere safe.\r\n\r\n' +
      codes.join('\r\n') + '\r\n';

    var url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    var link = document.createElement('a');
    link.href = url;
    link.download = 'accessible-mfa-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);

    // Say that it happened: a download starting is a silent event otherwise.
    window.AccessibleMFA.announce(
      'The file accessible-mfa-recovery-codes.txt was saved to your downloads.',
      'success',
    );
  });
})();
