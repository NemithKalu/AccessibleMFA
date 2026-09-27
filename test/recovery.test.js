/**
 * The lost-device journey: recovery code, waiting period, cancel, activate.
 *
 * The waiting period is set to a few milliseconds here so the tests can run;
 * it is 24 hours in the real configuration.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workDir = mkdtempSync(join(tmpdir(), 'accessible-mfa-recovery-'));
process.env.AMFA_DB_PATH = join(workDir, 'test.db');
process.env.PORT = '3996';
process.env.SESSION_SECRET = 'test-secret';
process.env.AMFA_RECOVERY_WAIT_MS = '150';

const { default: app } = await import('../src/app.js');
const { SoftwareAuthenticator } = await import('./authenticator.js');
const { createClient, registerAccount, signIn, ORIGIN, RP_ID } = await import('./client.js');

let server;

before(async () => {
  server = app.listen(Number(process.env.PORT));
  await new Promise((resolve) => server.once('listening', resolve));
});

after(() => {
  server.close();
  rmSync(workDir, { recursive: true, force: true });
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pastTheWait = () => wait(Number(process.env.AMFA_RECOVERY_WAIT_MS) + 50);

/** An account with one passkey and a set of recovery codes. */
async function accountWithCodes(username) {
  const authenticator = new SoftwareAuthenticator();
  const { client } = await registerAccount(username, { authenticator, deviceName: 'Old phone' });
  const page = await client.postForm('/recovery-codes', {});
  const codes = [...page.text.matchAll(/<code>([A-Z0-9-]+)<\/code>/g)].map((m) => m[1]);
  assert.equal(codes.length, 10);
  return { client, authenticator, codes };
}

/** Use a code from a fresh browser, as someone with no working device would. */
async function startRecovery(username, code) {
  const client = createClient();
  const started = await client.postForm('/recover', { username, code });
  return { client, started };
}

/** Register a replacement passkey on a recovery session. */
async function registerReplacement(client, authenticator = new SoftwareAuthenticator()) {
  const asked = await client.post('/webauthn/register/options', { deviceName: 'New phone' });
  if (asked.status !== 200) return { asked, verified: asked, authenticator };

  const attestation = authenticator.register({
    rpId: RP_ID,
    origin: ORIGIN,
    challenge: asked.body.challenge,
  });
  return { asked, verified: await client.post('/webauthn/register/verify', attestation), authenticator };
}

describe('starting a recovery', () => {
  it('accepts a valid code and opens a restricted session', async () => {
    const { codes } = await accountWithCodes('rec-alice');
    const { client, started } = await startRecovery('rec-alice', codes[0]);

    assert.equal(started.status, 302);
    assert.equal(started.location, '/recover/status');

    const status = await client.getPage('/recover/status');
    assert.match(status.text, /Waiting/);

    // Restricted means restricted: no new passkeys, no new recovery codes.
    const addPasskey = await registerReplacement(client);
    assert.equal(addPasskey.asked.status, 403);
    assert.match(addPasskey.asked.body.error, /waiting period has not finished/);

    const newCodes = await client.postForm('/recovery-codes', {});
    assert.equal(newCodes.status, 403);
  });

  it('burns the code, so the same one cannot be used again', async () => {
    const { codes } = await accountWithCodes('rec-bob');
    assert.equal((await startRecovery('rec-bob', codes[0])).started.status, 302);

    const second = await startRecovery('rec-bob', codes[0]);
    assert.equal(second.started.status, 400);
    assert.match(second.started.text, /did not match anything we hold/);
  });

  it('rejects a code that was never issued, and says what to do next', async () => {
    await accountWithCodes('rec-carol');

    const { started } = await startRecovery('rec-carol', 'ABCDE-FGHJK');
    assert.equal(started.status, 400);
    assert.match(started.text, /contact support/);
  });

  it('locks the account out after repeated wrong codes', async () => {
    await accountWithCodes('rec-dave');

    for (let i = 0; i < 5; i += 1) {
      await startRecovery('rec-dave', 'ZZZZZ-ZZZZZ');
    }
    const locked = await startRecovery('rec-dave', 'ZZZZZ-ZZZZZ');
    assert.equal(locked.started.status, 429);
    assert.match(locked.started.text, /Too many incorrect recovery codes/);
  });
});

describe('the waiting period', () => {
  it('blocks a replacement until it has passed, then allows it', async () => {
    const { codes } = await accountWithCodes('rec-erin');
    const { client } = await startRecovery('rec-erin', codes[0]);

    const tooSoon = await registerReplacement(client);
    assert.equal(tooSoon.asked.status, 403);

    await pastTheWait();

    const status = await client.getPage('/recover/status');
    assert.match(status.text, /Ready/);

    const done = await registerReplacement(client);
    assert.equal(done.verified.status, 200, done.verified.text);
  });
});

describe('cancelling', () => {
  it('lets the real owner stop it from a device that still works', async () => {
    const { authenticator, codes } = await accountWithCodes('rec-frank');
    const attacker = await startRecovery('rec-frank', codes[0]);

    // The owner's passkey still works during the wait — that is the point.
    const owner = await signIn('rec-frank', authenticator);
    assert.equal(owner.verified.status, 200, owner.verified.text);

    // And the account page tells them at once.
    const account = await owner.client.getPage('/account');
    assert.match(account.text, /Someone is replacing the passkeys/);

    const cancelled = await owner.client.postForm('/recover/cancel', {});
    assert.equal(cancelled.status, 302);

    // Cancellation wins even after the waiting period runs out.
    await pastTheWait();
    const attempt = await registerReplacement(attacker.client);
    assert.equal(attempt.asked.status, 403);
    assert.match(attempt.asked.body.error, /lost your devices, start a recovery/);
  });

  it('lets the restricted session cancel its own request and signs it out', async () => {
    const { codes } = await accountWithCodes('rec-grace');
    const { client } = await startRecovery('rec-grace', codes[0]);

    const cancelled = await client.postForm('/recover/cancel', {});
    assert.equal(cancelled.status, 302);
    assert.equal(cancelled.location, '/signin?from=cancelled');

    const status = await client.getPage('/recover/status');
    assert.equal(status.status, 302); // signed out
  });
});

describe('completing a replacement', () => {
  it('turns off the old passkey and ends the sessions using it', async () => {
    const { client: oldDevice, authenticator: oldKey, codes } = await accountWithCodes('rec-heidi');
    const { client } = await startRecovery('rec-heidi', codes[0]);

    await pastTheWait();
    const { verified, authenticator: newKey } = await registerReplacement(client);
    assert.equal(verified.status, 200, verified.text);

    // The lost device can no longer sign in...
    const oldAttempt = await signIn('rec-heidi', oldKey);
    assert.equal(oldAttempt.verified.status, 400);
    assert.match(oldAttempt.verified.body.error, /turned off/);

    // ...and the session it already had is over.
    assert.equal((await oldDevice.getPage('/account')).status, 302);

    // The new one works, and the recovery session was promoted to a full one.
    const account = await client.getPage('/account');
    assert.equal(account.status, 200);
    assert.match(account.text, /Add another passkey/);

    const newSignIn = await signIn('rec-heidi', newKey);
    assert.equal(newSignIn.verified.status, 200, newSignIn.verified.text);
  });

  it('records the whole journey in the activity log', async () => {
    const { codes } = await accountWithCodes('rec-ivan');
    const { client } = await startRecovery('rec-ivan', codes[0]);
    await pastTheWait();
    await registerReplacement(client);

    const activity = await client.getPage('/activity');
    assert.match(activity.text, /recovery code was accepted/);
    assert.match(activity.text, /replace all passkeys was started/);
    assert.match(activity.text, /replacement passkey was registered/);
    // And never the code itself.
    for (const code of codes) assert.doesNotMatch(activity.text, new RegExp(code));
  });
});
