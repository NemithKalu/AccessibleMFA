// Server-rendered pages.

import { Router } from 'express';
import { countUnusedRecoveryCodes, listCredentials } from '../db.js';
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
  res.render('signin', { title: 'Sign in' });
});

// Confirmations shown on arrival. Read from a whitelist, never echoed from
// the query string, so nothing user-supplied reaches the page.
const ARRIVAL_MESSAGES = {
  registered: 'Your account was created and you are signed in.',
  signedin: 'You are signed in.',
  added: 'Your new passkey was added.',
};

router.get('/account', requireSession, (req, res) => {
  res.render('account', {
    title: 'Your account',
    user: res.locals.user,
    credentials: listCredentials(res.locals.user.id),
    recoveryCodesRemaining: countUnusedRecoveryCodes(res.locals.user.id),
    arrivalMessage: ARRIVAL_MESSAGES[req.query.from] ?? null,
  });
});

export default router;
