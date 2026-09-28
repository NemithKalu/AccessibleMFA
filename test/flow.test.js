/**
 * End-to-end tests for the Phase 1 passkey flows.
 *
 * These drive the real Express app over HTTP against a throwaway database,
 * using the software authenticator in ./authenticator.js. They are here to
 * prove the security rules in CLAUDE.md actually hold — especially the ones
 * that are easy to get subtly wrong and impossible to eyeball: single-use
 * challenges, the user-verification flag, and the signature counter.
 *
 * What they cannot cover: the operating system's passkey prompt, focus order
 * and screen-reader output. Those need the browser pass described in the plan.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must be set before the app is imported: config and db read them at load.
const workDir = mkdtempSync(join(tmpdir(), 'accessible-mfa-test-'));
process.env.AMFA_DB_PATH = join(workDir, 'test.db');
process.env.PORT = '3999';
process.env.SESSION_SECRET = 'test-secret';

const { default: app } = await import('../src/app.js');
const { ORIGIN, RP_ID } = await import('../src/config.js');
const { SoftwareAuthenticator } = await import('./authenticator.js');

let server;

before(async () => {
  server = app.listen(Number(process.env.PORT));
  await new Promise((resolve) => server.once('listening', resolve));
});

after(() => {
  server.close();
  rmSync(workDir, { recursive: true, force: true });
});

/** A browser-like client: one cookie jar, JSON in and out. */
function createClient() {
  let cookie = null;
  return {
    get cookie() {
      return cookie;
    },
    async post(path, body) {
      const response = await fetch(`${ORIGIN}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify(body),
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { status: response.status, body: await response.json() };
    },
    async getPage(path) {
      const response = await fetch(`${ORIGIN}${path}`, {
        headers: cookie ? { Cookie: cookie } : {},
        redirect: 'manual',
      });
      return { status: response.status, text: await response.text() };
    },
  };
}

async function registerAccount(username, authenticator, client = createClient()) {
  const options = await client.post('/webauthn/register/options', {
    username,
    displayName: username,
    deviceName: 'Test authenticator',
  });
  assert.equal(options.status, 200, JSON.stringify(options.body));

  const attestation = authenticator.register({
    rpId: RP_ID,
    origin: ORIGIN,
    challenge: options.body.challenge,
  });
  const verified = await client.post('/webauthn/register/verify', attestation);
  return { client, options: options.body, verified };
}

async function signIn(username, authenticator, overrides = {}) {
  const client = createClient();
  const options = await client.post('/webauthn/auth/options', { username });
  assert.equal(options.status, 200, JSON.stringify(options.body));

  const assertion = authenticator.authenticate({
    rpId: RP_ID,
    origin: ORIGIN,
    challenge: options.body.challenge,
    ...overrides,
  });
  const verified = await client.post('/webauthn/auth/verify', assertion);
  return { client, assertion, verified, allowCredentials: options.body.allowCredentials };
}

describe('registration', () => {
  it('creates the account, stores the credential and signs the user in', async () => {
    const authenticator = new SoftwareAuthenticator();
    const { client, verified } = await registerAccount('alice', authenticator);

    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    assert.equal(verified.body.verified, true);
    assert.equal(verified.body.username, 'alice');

    // The session exists and the stored public key round-trips out of SQLite.
    const account = await client.getPage('/account');
    assert.equal(account.status, 200);
    assert.match(account.text, /Test authenticator/);
  });

  it('refuses a username that is already taken, naming the reason', async () => {
    const options = await createClient().post('/webauthn/register/options', {
      username: 'alice',
    });
    assert.equal(options.status, 400);
    assert.match(options.body.error, /already taken/);
  });

  it('rejects a registration where the device did not verify the user', async () => {
    const authenticator = new SoftwareAuthenticator();
    const client = createClient();
    const options = await client.post('/webauthn/register/options', {
      username: 'noverify',
      deviceName: 'Unverified',
    });

    // The user-verification flag is what makes this multi-factor. An
    // authenticator that only proves presence must not be accepted.
    const attestation = authenticator.register({
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.body.challenge,
      userVerified: false,
    });
    const verified = await client.post('/webauthn/register/verify', attestation);

    assert.equal(verified.status, 400);
    assert.match(verified.body.error, /did not confirm it was you|User verification/i);

    // And no account was created as a side effect.
    const retry = await createClient().post('/webauthn/register/options', {
      username: 'noverify',
    });
    assert.equal(retry.status, 200);
  });

  it('lists existing credentials in excludeCredentials so a device cannot enrol twice', async () => {
    const authenticator = new SoftwareAuthenticator();
    const { client } = await registerAccount('bob', authenticator);

    const options = await client.post('/webauthn/register/options', {
      deviceName: 'Second passkey',
    });
    assert.equal(options.status, 200);

    const excluded = options.body.excludeCredentials.map((entry) => entry.id);
    assert.deepEqual(excluded, [authenticator.credentialIdB64]);
  });
});

describe('authentication', () => {
  it('signs in with a username and records the credential as used', async () => {
    const authenticator = new SoftwareAuthenticator();
    await registerAccount('carol', authenticator);

    const { client, verified, allowCredentials } = await signIn('carol', authenticator);

    // The whole point of the username-first path: the browser is told exactly
    // which passkey to use, instead of falling back to the account picker.
    assert.deepEqual(
      allowCredentials.map((entry) => entry.id),
      [authenticator.credentialIdB64],
    );

    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    assert.equal(verified.body.username, 'carol');

    const account = await client.getPage('/account');
    assert.equal(account.status, 200);
    assert.doesNotMatch(account.text, /Not used yet/);
  });

  it('signs in with no username, resolving the account from the user handle', async () => {
    const authenticator = new SoftwareAuthenticator();
    const { options } = await registerAccount('dave', authenticator);

    const client = createClient();
    // No username: the server sends no allowCredentials list at all, which is
    // what lets the authenticator offer the account by itself.
    const authOptions = await client.post('/webauthn/auth/options', {});
    assert.equal(authOptions.body.allowCredentials, undefined);

    const assertion = authenticator.authenticate({
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: authOptions.body.challenge,
      userHandle: options.user.id,
    });
    const verified = await client.post('/webauthn/auth/verify', assertion);

    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    assert.equal(verified.body.username, 'dave');
  });

  it('rejects an assertion whose user handle belongs to another account', async () => {
    const mallory = new SoftwareAuthenticator();
    const victim = new SoftwareAuthenticator();
    await registerAccount('mallory', mallory);
    const { options: victimOptions } = await registerAccount('victim', victim);

    const { verified } = await signIn('mallory', mallory, {
      userHandle: victimOptions.user.id,
    });

    assert.equal(verified.status, 400);
    assert.equal(verified.body.code, 'account-mismatch');
    assert.match(verified.body.error, /^Sign-in was not completed\./);
    assert.match(verified.body.error, /belongs to a different account/);
  });

  it('rejects an assertion without the user-verification flag', async () => {
    const authenticator = new SoftwareAuthenticator();
    await registerAccount('erin', authenticator);

    const { verified } = await signIn('erin', authenticator, { userVerified: false });

    assert.equal(verified.status, 400);
    assert.equal(verified.body.code, 'not-verified');
    assert.match(verified.body.error, /^Sign-in was not completed\./);
    assert.match(verified.body.error, /did not confirm it was you/);
  });

  it('names the reason when the username does not exist', async () => {
    const options = await createClient().post('/webauthn/auth/options', {
      username: 'nobody',
    });
    assert.equal(options.status, 400);
    assert.equal(options.body.code, 'no-account');
    assert.match(options.body.error, /^Sign-in was not completed\./);
    assert.match(options.body.error, /no account called/);
  });
});

describe('challenges are single use', () => {
  it('rejects a replay of a complete, previously successful assertion', async () => {
    const authenticator = new SoftwareAuthenticator();
    await registerAccount('frank', authenticator);

    const client = createClient();
    const options = await client.post('/webauthn/auth/options', { username: 'frank' });
    const assertion = authenticator.authenticate({
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.body.challenge,
    });

    const first = await client.post('/webauthn/auth/verify', assertion);
    assert.equal(first.status, 200, JSON.stringify(first.body));

    // Exactly the same body, same session. The challenge was deleted before
    // the first verification ran, so there is nothing left to match.
    const replay = await client.post('/webauthn/auth/verify', assertion);
    assert.equal(replay.status, 400);
    assert.equal(replay.body.code, 'request-expired');
    assert.match(replay.body.error, /^Sign-in was not completed\./);
    assert.match(replay.body.error, /expired or was already used/);
  });

  it('will not accept a registration response where a sign-in was asked for', async () => {
    const authenticator = new SoftwareAuthenticator();
    await registerAccount('grace', authenticator);

    const client = createClient();
    const options = await client.post('/webauthn/auth/options', { username: 'grace' });
    const attestation = authenticator.register({
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.body.challenge,
    });

    const verified = await client.post('/webauthn/register/verify', attestation);
    assert.equal(verified.status, 400);
    assert.match(verified.body.error, /expired or was already used|did not match/);
  });
});

describe('the signature counter', () => {
  it('accepts a counter that keeps increasing', async () => {
    const authenticator = new SoftwareAuthenticator();
    await registerAccount('heidi', authenticator);

    const first = await signIn('heidi', authenticator); // reports 1
    assert.equal(first.verified.status, 200, JSON.stringify(first.verified.body));

    const second = await signIn('heidi', authenticator); // reports 2
    assert.equal(second.verified.status, 200, JSON.stringify(second.verified.body));
  });

  it('rejects a counter that goes backwards, which can mean a cloned passkey', async () => {
    const authenticator = new SoftwareAuthenticator();
    await registerAccount('ivan', authenticator);

    await signIn('ivan', authenticator); // reports 1, stored
    await signIn('ivan', authenticator); // reports 2, stored

    const clone = await signIn('ivan', authenticator, { counter: 1 });
    assert.equal(clone.verified.status, 400);
    assert.equal(clone.verified.body.code, 'possible-copy');
    assert.match(clone.verified.body.error, /^Sign-in was not completed\./);
    assert.match(clone.verified.body.error, /may have been copied/);
  });

  it('keeps working with a synced passkey that always reports zero', async () => {
    // iCloud Keychain and Google Password Manager cannot keep a counter in
    // step across devices, so they report 0 every time. Sign in twice: if the
    // counter rule were naive, the second attempt would fail and the user
    // would be locked out for good.
    const authenticator = new SoftwareAuthenticator({ backupEligible: true, backedUp: true });
    await registerAccount('judy', authenticator);

    const first = await signIn('judy', authenticator, { counter: 0 });
    assert.equal(first.verified.status, 200, JSON.stringify(first.verified.body));

    const second = await signIn('judy', authenticator, { counter: 0 });
    assert.equal(second.verified.status, 200, JSON.stringify(second.verified.body));
  });
});

describe('sessions', () => {
  it('keeps the account page away from anonymous visitors', async () => {
    const page = await createClient().getPage('/account');
    assert.equal(page.status, 302);
  });

  it('issues a different session id after signing in', async () => {
    const authenticator = new SoftwareAuthenticator();
    await registerAccount('ken', authenticator);

    const client = createClient();
    await client.post('/webauthn/auth/options', { username: 'ken' });
    const beforeSignIn = client.cookie; // set while the challenge was stored

    const options = await client.post('/webauthn/auth/options', { username: 'ken' });
    const assertion = authenticator.authenticate({
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.body.challenge,
    });
    await client.post('/webauthn/auth/verify', assertion);

    // regenerate() must have replaced the pre-sign-in session, not reused it.
    assert.notEqual(client.cookie, beforeSignIn);
  });
});
