// Server-rendered pages.

import { Router } from 'express';
import * as db from '../db.js';
import { listAuditEntries } from '../db.js';
import { requireSession } from '../guards.js';
import { usernameFromQuery } from '../text.js';

const router = Router();

router.get('/', (req, res) => {
  res.render('index', { title: 'Home' });
});

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/account');
  res.render('register', { title: 'Create your account' });
});

router.get('/signin', (req, res) => {
  if (req.session.userId) return res.redirect('/account');
  res.render('signin', {
    title: 'Sign in',
    arrivalMessage: SIGNIN_MESSAGES[req.query.from] ?? null,
    // Set when coming back from "Other ways to sign in", so the name typed
    // before does not have to be typed again. Only a valid username is kept.
    username: usernameFromQuery(req.query.username),
  });
});

// "Use another method" from the sign-in page (plan step 4). Reached only by
// the user's own choice — nothing here redirects a visitor to it (AR-10).
router.get('/signin/other', (req, res) => {
  if (req.session.userId) return res.redirect('/account');
  res.render('signin-other', {
    title: 'Other ways to sign in',
    username: usernameFromQuery(req.query.username),
  });
});

// Confirmations shown on arrival. Read from a whitelist, never echoed from
// the query string, so nothing user-supplied reaches the page.
const ARRIVAL_MESSAGES = {
  registered: 'Your account was created and you are signed in.',
  signedin: 'You are signed in.',
  added: 'Your new passkey was added.',
  renamed: 'That passkey was renamed.',
  revoked: 'That passkey was turned off and can no longer be used to sign in.',
  cancelled: 'The passkey replacement was cancelled. Nothing on your account changed.',
  recovered: 'Your new passkey is registered and your older passkeys were turned off.',
};

// Shown on the sign-in page. Separate list, so /account messages cannot be
// made to appear on a page an anonymous visitor can reach.
const SIGNIN_MESSAGES = {
  revoked:
    'That passkey was turned off, so you were signed out. Sign in with another passkey, or use a recovery code.',
  cancelled:
    'The passkey replacement was cancelled and you were signed out of the restricted session. Your existing passkeys still work.',
};

router.get('/account', requireSession, (req, res) => {
  res.render('account', {
    title: 'Your account',
    user: res.locals.user,
    credentials: db.listCredentials(res.locals.user.id),
    activeCount: db.listActiveCredentials(res.locals.user.id).length,
    // Lets the list mark the passkey this browser is signed in with.
    currentCredentialId: req.session.credentialId ?? null,
    recoveryCodesRemaining: db.countUnusedRecoveryCodes(res.locals.user.id),
    // Surfaced at the top of the page: somebody signing in normally must be
    // told at once that a replacement is running, because they are the person
    // who can cancel it.
    pendingRecovery: db.findPendingRecoveryRequest(res.locals.user.id),
    arrivalMessage: ARRIVAL_MESSAGES[req.query.from] ?? null,
  });
});

// The audit log. Read only, and shown to restricted sessions too — seeing
// what has happened to your own account is exactly what someone who suspects
// a takeover needs, and it reveals nothing an attacker does not already know.
router.get('/activity', requireSession, (req, res) => {
  res.render('activity', {
    title: 'Account activity',
    entries: listAuditEntries(res.locals.user.id),
  });
});

export default router;
