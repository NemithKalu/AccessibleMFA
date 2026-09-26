// The four WebAuthn endpoints. This is where every security check lives.

import { Router } from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

import { ORIGIN, RP_ID, RP_NAME } from '../config.js';
import { consumeChallenge, issueChallenge } from '../challenge.js';
import { AuthError } from '../errors.js';
import * as db from '../db.js';

const router = Router();

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

function normaliseUsername(raw) {
  const username = String(raw ?? '').trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new AuthError(
      'That username will not work. Use 3 to 32 characters: letters, numbers, dots, dashes or underscores.',
    );
  }
  return username;
}

function cleanLabel(raw, fallback) {
  const label = String(raw ?? '').trim().slice(0, 64);
  return label || fallback;
}

/**
 * Sign the user in. Called only after an assertion has been fully verified.
 */
function startSession(req, user) {
  return new Promise((resolve, reject) => {
    // Regenerate to defeat session fixation: an attacker who planted a session
    // ID in this browser before sign-in must not end up holding a signed-in one.
    req.session.regenerate((err) => {
      if (err) return reject(err);
      // Set inside the callback — regenerate() replaces the session object, so
      // anything written before this point is gone.
      req.session.userId = user.id;
      req.session.level = 'full'; // established by a passkey with user verification
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

router.post('/register/options', async (req, res) => {
  // Two ways in: a signed-in user adding another passkey, or a brand new
  // account. Adding a passkey changes the credentials on an account, so it
  // needs a full session, never a restricted fallback one.
  const addingToExistingAccount = Boolean(req.session.userId);
  if (addingToExistingAccount && req.session.level !== 'full') {
    throw new AuthError(
      'Adding a passkey needs a full sign-in with an existing passkey.',
      403,
    );
  }

  let user = null;
  let pending = null;

  if (addingToExistingAccount) {
    user = db.findUserById(req.session.userId);
    if (!user) throw new AuthError('Your session is no longer valid. Please sign in again.', 401);
  } else {
    const username = normaliseUsername(req.body.username);
    if (db.findUserByUsername(username)) {
      throw new AuthError(
        `The username “${username}” is already taken. Please choose a different one.`,
      );
    }
    // The account row is only written once a passkey actually exists, so an
    // abandoned registration leaves nothing behind and does not hold a name.
    pending = {
      username,
      displayName: cleanLabel(req.body.displayName, username),
      userHandle: db.generateUserHandle(),
    };
  }

  const userHandle = user ? user.user_handle : pending.userHandle;
  const existingCredentials = user ? db.listCredentials(user.id) : [];

  const challenge = issueChallenge(req, 'register', {
    userId: user?.id ?? null,
    pending,
    deviceName: cleanLabel(req.body.deviceName, 'Unnamed passkey'),
  });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: user ? user.username : pending.username,
    userDisplayName: user ? user.display_name : pending.displayName,
    // WebAuthn's user.id is the random handle, never the username or row id.
    userID: Buffer.from(userHandle, 'base64url'),
    challenge,
    attestationType: 'none',
    // Stops the same authenticator being registered twice on one account: the
    // browser refuses rather than silently creating a second credential.
    excludeCredentials: existingCredentials.map((credential) => ({
      id: credential.id,
      transports: credential.transports,
    })),
    authenticatorSelection: {
      // A discoverable credential is what makes the "sign in without typing"
      // button possible — the authenticator can find the account by itself.
      residentKey: 'preferred',
      // REQUIRED, not preferred. The user-verification flag is the second
      // factor; without it this is single-factor possession only.
      userVerification: 'required',
    },
  });

  res.json(options);
});

router.post('/register/verify', async (req, res) => {
  // Read and delete the challenge before verifying anything: single use.
  const challenge = consumeChallenge(req, 'register');

  const verification = await explainFailures('register', () =>
    verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: challenge.value,
      expectedOrigin: ORIGIN, // pins scheme, host and port
      expectedRPID: RP_ID, // pins the domain the credential is bound to
      requireUserVerification: true,
    }),
  );

  if (!verification.verified || !verification.registrationInfo) {
    throw new AuthError('That passkey could not be verified. Please try again.');
  }

  const { credential, credentialBackedUp, credentialDeviceType, userVerified } =
    verification.registrationInfo;

  // Belt and braces. requireUserVerification above already enforces this, but
  // the project rule is to never accept a credential without user
  // verification, and that deserves a check we can point at rather than a
  // library default we are trusting.
  if (!userVerified) {
    throw new AuthError(
      'Your device did not confirm it was you, so this passkey was not saved. Please try again and complete the fingerprint, face or PIN check.',
    );
  }

  // Only now, with a verified credential in hand, does the account get written.
  let user;
  if (challenge.data.userId) {
    user = db.findUserById(challenge.data.userId);
    if (!user) throw new AuthError('Your session is no longer valid. Please sign in again.', 401);
  } else {
    const { username, displayName, userHandle } = challenge.data.pending;
    if (db.findUserByUsername(username)) {
      throw new AuthError(
        `The username “${username}” was taken while you were registering. Please choose a different one.`,
      );
    }
    user = db.createUser({ username, displayName, userHandle });
  }

  db.addCredential({
    id: credential.id,
    userId: user.id,
    publicKey: credential.publicKey, // public half only
    counter: credential.counter,
    transports: credential.transports,
    deviceName: challenge.data.deviceName,
    backedUp: credentialBackedUp,
    backupEligible: credentialDeviceType === 'multiDevice',
  });

  // Registering a passkey proves the same things signing in does, so the new
  // account is signed in straight away rather than making the user repeat it.
  if (!req.session.userId) await startSession(req, user);

  res.json({
    verified: true,
    username: user.username,
    next: '/account',
  });
});

/**
 * @simplewebauthn/server reports every verification failure as a plain Error
 * with a developer-facing message ("User verification required, but user could
 * not be verified"). Left alone those reach the page as a generic "something
 * went wrong", which is precisely the bare, reasonless failure the
 * accessibility rules forbid — and the most security-relevant rejections are
 * the ones that would be silenced.
 *
 * So each known failure is translated into a sentence that says what happened
 * and what to do about it. The original is logged for us, never shown.
 */
async function explainFailures(context, run) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AuthError) throw error;
    console.warn(`[webauthn:${context}] ${error.message}`);
    throw new AuthError(translateVerificationError(error.message, context));
  }
}

function translateVerificationError(message, context) {
  if (/user verification/i.test(message)) {
    return 'Your device did not confirm it was you, so you were not signed in. Please try again and complete the fingerprint, face or PIN check.';
  }
  if (/user not present/i.test(message)) {
    return 'Your device did not register a touch or a button press. Please try again.';
  }
  if (/counter value/i.test(message)) {
    return 'This passkey reported an out-of-date use count, which can mean it has been copied. It was not accepted. Please use another passkey.';
  }
  if (/challenge/i.test(message)) {
    return 'That request has expired or was already used. Please start again.';
  }
  if (/origin/i.test(message)) {
    return 'The request came from the wrong web address, so it was refused. Open the site again from the start.';
  }
  if (/RP ID/i.test(message)) {
    return 'That passkey belongs to a different website, so it cannot be used here.';
  }
  return context === 'register'
    ? 'That passkey could not be verified, so it was not saved. Please try again.'
    : 'That passkey could not be verified, so you were not signed in. Please try again.';
}

export default router;
