// Account management: recovery codes, and (next) the device list.

import { Router } from 'express';

import * as db from '../db.js';
import { requireFullSession, requireSession } from '../guards.js';
import { CODE_COUNT, generateCodes, hashCode } from '../recovery-codes.js';

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

export default router;
