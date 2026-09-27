// Account management: recovery codes, and (next) the device list.

import { Router } from 'express';

import * as db from '../db.js';
import { AuthError } from '../errors.js';
import { requireFullSession, requireSession } from '../guards.js';
import { CODE_COUNT, generateCodes, hashCode } from '../recovery-codes.js';
import { cleanLabel } from '../text.js';

const router = Router();

router.get('/recovery-codes', requireSession, (req, res) => {
  res.render('recovery-codes', {
    title: 'Recovery codes',
    remaining: db.countUnusedRecoveryCodes(res.locals.user.id),
    codes: null, // only ever non-null on the page that just generated them
  });
});

// POST, and behind requireFullSession: generating codes replaces the old set,
// which is a change to how the account can be recovered. A restricted fallback
// session must never be able to mint itself a fresh way back in.
router.post('/recovery-codes', requireFullSession, (req, res) => {
  const user = res.locals.user;
  const codes = generateCodes();

  // Only the hashes reach the database. This is the one and only moment the
  // plaintext exists, so the page below has to be where the user saves them.
  db.replaceRecoveryCodes(user.id, codes.map(hashCode));
  db.addAuditEntry({
    userId: user.id,
    event: 'recovery-codes-generated',
    detail: `${CODE_COUNT} new recovery codes were created. Any earlier codes stopped working.`,
  });

  res.render('recovery-codes', {
    title: 'Your recovery codes',
    remaining: CODE_COUNT,
    codes,
  });
});

// ---------------------------------------------------------------------------
// Device management
//
// Both routes are behind requireFullSession: renaming and revoking are changes
// to the registered devices, which a restricted fallback session must never be
// able to make.
// ---------------------------------------------------------------------------

/** The named device, or an error — never another user's. */
function ownedCredential(req, res) {
  const credential = db.findCredentialById(String(req.params.id));
  if (!credential || credential.userId !== res.locals.user.id) {
    throw new AuthError('That passkey is not on your account.', 404);
  }
  return credential;
}

router.post('/devices/:id/rename', requireFullSession, (req, res) => {
  const credential = ownedCredential(req, res);
  const deviceName = cleanLabel(req.body.deviceName, credential.deviceName);

  db.renameCredential({ id: credential.id, userId: res.locals.user.id, deviceName });
  res.redirect('/account?from=renamed');
});

router.post('/devices/:id/revoke', requireFullSession, (req, res) => {
  const user = res.locals.user;
  const credential = ownedCredential(req, res);

  if (credential.status !== 'active') {
    throw new AuthError('That passkey has already been turned off.');
  }

  // Do not let the user lock themselves out. Removing the only way in is fine
  // if there are recovery codes to come back with, and a trap if there are not.
  const active = db.listActiveCredentials(user.id);
  if (active.length === 1 && db.countUnusedRecoveryCodes(user.id) === 0) {
    throw new AuthError(
      'This is your only passkey and you have no recovery codes, so turning it off would lock you out of this account. Add another passkey, or create recovery codes, first.',
    );
  }

  db.revokeCredential({ id: credential.id, userId: user.id });
  db.addAuditEntry({
    userId: user.id,
    event: 'device-revoked',
    detail: `The passkey “${credential.deviceName}” was turned off.`,
  });

  // Revoking the passkey you are currently using signs you out: requireSession
  // notices on the next request. Say so plainly rather than letting the user
  // wonder why they landed back on the sign-in page.
  res.redirect(
    req.session.credentialId === credential.id ? '/signin?from=revoked' : '/account?from=revoked',
  );
});

export default router;
