// The Express application: every route and every piece of middleware.
// server.js starts it; the tests mount it on a port of their own.

import express from 'express';
import session from 'express-session';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SESSION_SECRET, ORIGIN, RP_NAME } from './config.js';
import { findUserById } from './db.js';
import { AuthError } from './errors.js';
import pagesRouter from './routes/pages.js';
import webauthnRouter from './routes/webauthn.js';
import authRouter from './routes/auth.js';
import accountRouter from './routes/account.js';
import recoverRouter from './routes/recover.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = express();

app.set('view engine', 'ejs');
app.set('views', join(root, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(join(root, 'public')));

// Serve @simplewebauthn/browser straight from node_modules as a plain script.
// Keeps the promise of "npm start and nothing else" — no bundler, no build step.
app.use(
  '/vendor',
  express.static(join(root, 'node_modules/@simplewebauthn/browser/dist/bundle')),
);

app.use(
  session({
    name: 'amfa.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // not readable from JavaScript
      sameSite: 'lax', // not sent on cross-site POSTs
      secure: false, // http://localhost only; would be true behind TLS
      maxAge: 1000 * 60 * 60,
    },
  }),
);

// Make the signed-in user available to every template, for the nav bar.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.userId ? findUserById(req.session.userId) : null;
  res.locals.sessionLevel = req.session.level ?? null;
  res.locals.origin = ORIGIN;
  res.locals.siteName = RP_NAME;
  next();
});

app.use('/', pagesRouter);
app.use('/webauthn', webauthnRouter);
app.use('/', authRouter);
app.use('/', accountRouter);
app.use('/', recoverRouter);

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page not found',
    message: 'That page does not exist.',
  });
});

// Central error handler. AuthError messages are written for people and are
// safe to show; anything else is logged server-side and reported generically,
// so an internal failure never leaks detail into the page.
app.use((err, req, res, _next) => {
  const isAuthError = err instanceof AuthError;
  if (!isAuthError) console.error(err);

  const status = isAuthError ? err.status : 500;
  const message = isAuthError
    ? err.message
    : 'Something went wrong on our side. Please try again.';

  if (req.accepts('html') && !req.is('application/json')) {
    return res.status(status).render('error', { title: 'Something went wrong', message });
  }
  res.status(status).json({ error: message });
});

export default app;
