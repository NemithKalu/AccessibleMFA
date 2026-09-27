// The "I have lost every device" journey.

import { Router } from 'express';

import { clearFailures, lockedFor, recordFailure } from '../attempts.js';
import * as db from '../db.js';
import { AuthError } from '../errors.js';
import { requireSession } from '../guards.js';
import * as recovery from '../recovery.js';
import { hashCode } from '../recovery-codes.js';
import { startSession } from '../session.js';

const router = Router();

router.get('/recover', (req, res) => {
  if (req.session.userId) return res.redirect('/recover/status');
  res.render('recover', { title: 'Lost your device', error: null, username: '' });
});

// Failures here re-render the form with the reason above it, rather than
// throwing the user onto a dead-end error page. Somebody who has just lost
// their phone is already having a bad day; they should not also lose what
// they typed and have to navigate back.
router.post('/recover', async (req, res) => {
  try {
    await attemptRecovery(req, res);
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    res.status(error.status).render('recover', {
      title: 'Lost your device',
      error: error.message,
      username: String(req.body.username ?? ''),
    });
  }
});

async function attemptRecovery(req, res) {
  const username = String(req.body.username ?? '').trim().toLowerCase();
  const code = String(req.body.code ?? '');

  // Rate limited by username, so a stolen username plus guesswork does not
  // get 2^49 tries at a recovery code.
  const lockMs = lockedFor(username);
  if (lockMs > 0) {
    throw new AuthError(
      `Too many incorrect recovery codes were entered for this account. Try again in ${Math.ceil(lockMs / 60000)} minutes, or contact support.`,
      429,
    );
  }

  const user = db.findUserByUsername(username);
  // One message for "no such account" and "wrong code": at this point in the
  // journey the two are the same mistake to the user, and saying which is
  // which would hand an attacker a way to test usernames against the slower,
  // rate-limited endpoint.
  const stored = user ? db.findUnusedRecoveryCode(user.id, hashCode(code)) : undefined;

  if (!stored || !db.useRecoveryCode(stored.id)) {
    recordFailure(username);
    throw new AuthError(
      'That username and recovery code did not match anything we hold. Check you have typed the code exactly as it was given, and that you have not already used it. Each code works only once. If you have run out of codes, you will need to contact support to prove who you are another way.',
    );
  }
  clearFailures(username);

  db.addAuditEntry({
    userId: user.id,
    event: 'recovery-code-used',
    detail: 'A recovery code was accepted. That code cannot be used again.',
  });

  // One request at a time. If one is already running, reuse it rather than
  // letting someone restart the clock or stack up requests.
  const request =
    db.findPendingRecoveryRequest(user.id) ?? recovery.startRequest(user, 'recovery-code');

  // RESTRICTED, not full. A recovery code is one secret; it is enough to look
  // at the account and to wait, and nowhere near enough to change it.
  await startSession(req, { user, level: 'restricted' });

  res.redirect('/recover/status');
}

router.get('/recover/status', requireSession, (req, res) => {
  const request = db.findPendingRecoveryRequest(res.locals.user.id);
  res.render('recover-status', {
    title: 'Replacing your passkeys',
    request,
    matured: request ? recovery.hasMatured(request) : false,
    remaining: request ? recovery.describeRemaining(request.activates_at) : null,
    readyAt: request ? recovery.formatMoment(request.activates_at) : null,
  });
});

// Any signed-in session may cancel, restricted ones included. Cancelling only
// ever leaves the account as it was, so there is no reason to make the real
// owner jump through a hoop to stop a replacement they did not ask for.
router.post('/recover/cancel', requireSession, (req, res) => {
  const request = db.findPendingRecoveryRequest(res.locals.user.id);
  if (!request) throw new AuthError('There is no replacement request to cancel.');

  recovery.cancelRequest(res.locals.user, request);

  // A restricted session only existed to run this recovery, so end it too.
  if (req.session.level !== 'full') {
    return req.session.destroy(() => res.redirect('/signin?from=cancelled'));
  }
  res.redirect('/account?from=cancelled');
});

export default router;
