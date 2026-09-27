// Server-rendered pages.

import { Router } from 'express';
import { countUnusedRecoveryCodes, listActiveCredentials, listCredentials } from '../db.js';
import { requireSession } from '../guards.js';

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
};

// Shown on the sign-in page. Separate list, so /account messages cannot be
// made to appear on a page an anonymous visitor can reach.
const SIGNIN_MESSAGES = {
  revoked:
    'That passkey was turned off, so you were signed out. Sign in with another passkey, or use a recovery code.',
};

router.get('/account', requireSession, (req, res) => {
  res.render('account', {
    title: 'Your account',
    user: res.locals.user,
    credentials: listCredentials(res.locals.user.id),
    activeCount: listActiveCredentials(res.locals.user.id).length,
    // Lets the list mark the passkey this browser is signed in with.
    currentCredentialId: req.session.credentialId ?? null,
    recoveryCodesRemaining: countUnusedRecoveryCodes(res.locals.user.id),
    arrivalMessage: ARRIVAL_MESSAGES[req.query.from] ?? null,
  });
});

export default router;
