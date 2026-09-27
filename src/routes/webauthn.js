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
import * as recovery from '../recovery.js';
import { startSession } from '../session.js';
import { cleanLabel } from '../text.js';

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

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

router.post('/register/options', async (req, res) => {
  // Two ways in: a signed-in user adding another passkey, or a brand new
  // account. Adding a passkey changes the credentials on an account, so it
  // needs a full session, never a restricted fallback one.
  const addingToExistingAccount = Boolean(req.session.userId);

  let user = null;
  let pending = null;

  if (addingToExistingAccount) {
    user = db.findUserById(req.session.userId);
    if (!user) throw new AuthError('Your session is no longer valid. Please sign in again.', 401);

    // A restricted session normally cannot touch credentials at all. The one
    // exception is a recovery request that has served its waiting period —
    // that is the whole point of the recovery journey. assertMayReplacePasskey
    // throws with the specific reason if this is not that case.
    if (req.session.level !== 'full') recovery.assertMayReplacePasskey(user);
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
  // Active ones only. A revoked passkey must not block the user from
  // enrolling that same device again after they get it back.
  const existingCredentials = user ? db.listActiveCredentials(user.id) : [];

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

  // Re-checked here, not just when the options were handed out: the request
  // may have been cancelled in between, and cancellation has to win.
  const replacing =
    req.session.userId && req.session.level !== 'full'
      ? recovery.assertMayReplacePasskey(user)
      : null;

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
  if (!req.session.userId) {
    await startSession(req, { user, level: 'full', credentialId: credential.id });
  }

  if (replacing) {
    recovery.completeReplacement({ user, request: replacing, newCredentialId: credential.id });
    // The user holds a working passkey again, so the restricted session is
    // replaced by a full one. Their old devices' sessions die with the
    // credentials that were just revoked.
    await startSession(req, { user, level: 'full', credentialId: credential.id });
  }

  res.json({
    verified: true,
    username: user.username,
    next: replacing ? '/account?from=recovered' : '/account',
  });
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

router.post('/auth/options', async (req, res) => {
  const rawUsername = String(req.body.username ?? '').trim();
  let allowCredentials; // left undefined for the usernameless path

  if (rawUsername) {
    const username = normaliseUsername(rawUsername);
    const user = db.findUserByUsername(username);

    // This tells an attacker whether a username exists. That is a deliberate
    // trade-off, not an oversight: choosing a username at registration already
    // reveals the same thing, and an accessible failure has to say what went
    // wrong. Silently falling through to the passkey picker would leave a
    // screen-reader user with a prompt that lists nothing and no explanation.
    if (!user) {
      throw new AuthError(
        `There is no account with the username “${username}”. Check the spelling, or create an account.`,
      );
    }

    const credentials = db.listActiveCredentials(user.id);
    if (credentials.length === 0) {
      throw new AuthError(
        'That account has no passkeys that can be used, so it cannot be signed in to. Use a recovery code instead.',
      );
    }

    // Naming the account's credentials lets the browser go straight to the
    // right passkey instead of asking the user to pick.
    allowCredentials = credentials.map((credential) => ({
      id: credential.id,
      transports: credential.transports,
    }));
  }

  const challenge = issueChallenge(req, 'authenticate');

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    challenge,
    allowCredentials,
    // REQUIRED — the UV flag is the second factor.
    userVerification: 'required',
  });

  res.json(options);
});

router.post('/auth/verify', async (req, res) => {
  // Read and delete the challenge before verifying anything: single use.
  const challenge = consumeChallenge(req, 'authenticate');

  const stored = db.findCredentialById(String(req.body.id ?? ''));
  if (!stored) {
    throw new AuthError(
      'That passkey is not registered with this site. Try another passkey, or create an account.',
    );
  }

  // A revoked passkey is refused here as well as being left out of
  // allowCredentials, because allowCredentials is only a hint to the browser —
  // a lost device can still present its credential without being asked.
  if (stored.status !== 'active') {
    throw new AuthError(
      'That passkey was turned off for this account and can no longer be used to sign in.',
    );
  }

  // Usernameless sign-in: the authenticator hands back the user handle it was
  // given at registration, and the account is looked up from that. Both are
  // base64url strings, so they compare directly.
  const userHandle = req.body.response?.userHandle;
  if (userHandle) {
    const claimed = db.findUserByHandle(userHandle);
    if (!claimed || claimed.id !== stored.userId) {
      throw new AuthError('That passkey does not match the account it claims. Please try again.');
    }
  }

  const verification = await explainFailures('authenticate', () =>
    verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: challenge.value,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: stored.id,
        publicKey: stored.publicKey,
        counter: stored.counter,
        transports: stored.transports,
      },
      requireUserVerification: true,
    }),
  );

  const { verified, authenticationInfo } = verification;
  if (!verified) {
    throw new AuthError('That passkey could not be verified. Please try again.');
  }

  // Same belt-and-braces check as registration: never accept an assertion
  // without the user-verification flag, because that flag is what makes this
  // multi-factor rather than possession of the device alone.
  if (!authenticationInfo.userVerified) {
    throw new AuthError(
      'Your device did not confirm it was you, so you were not signed in. Please try again and complete the fingerprint, face or PIN check.',
    );
  }

  assertCounterIsSane(stored.counter, authenticationInfo.newCounter);

  db.recordCredentialUse({
    id: stored.id,
    counter: authenticationInfo.newCounter,
    backedUp: authenticationInfo.credentialBackedUp,
  });

  const user = db.findUserById(stored.userId);
  await startSession(req, { user, level: 'full', credentialId: stored.id });

  res.json({ verified: true, username: user.username, next: '/account' });
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

/**
 * The signature counter is a cloning detector: a real authenticator increments
 * it on every assertion, so a counter that goes backwards suggests a copy of
 * the credential is in use.
 *
 * The catch: synced passkeys (iCloud Keychain, Google Password Manager) cannot
 * keep a counter in step across devices, so they report 0 every single time.
 * Rejecting "not greater than stored" would let such a user sign in once and
 * then lock them out forever. Zero on both sides means the authenticator does
 * not implement the counter, so there is nothing to compare.
 */
function assertCounterIsSane(storedCounter, newCounter) {
  if (storedCounter === 0 && newCounter === 0) return;
  if (newCounter > storedCounter) return;

  throw new AuthError(
    'This passkey reported an out-of-date use count, which can mean it has been copied. It was not accepted. Please use another passkey.',
  );
}

export default router;
