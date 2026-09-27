/**
 * Device management: renaming, revoking, and the rules that stop a revoke
 * from being a trapdoor.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workDir = mkdtempSync(join(tmpdir(), 'accessible-mfa-devices-'));
process.env.AMFA_DB_PATH = join(workDir, 'test.db');
process.env.PORT = '3997';
process.env.SESSION_SECRET = 'test-secret';

const { default: app } = await import('../src/app.js');
const { SoftwareAuthenticator } = await import('./authenticator.js');
const { createClient, registerAccount, signIn } = await import('./client.js');

let server;

before(async () => {
  server = app.listen(Number(process.env.PORT));
  await new Promise((resolve) => server.once('listening', resolve));
});

after(() => {
  server.close();
  rmSync(workDir, { recursive: true, force: true });
});

/** An account with two passkeys, so one can be revoked safely. */
async function accountWithTwoPasskeys(username) {
  const first = new SoftwareAuthenticator();
  const second = new SoftwareAuthenticator();
  const { client } = await registerAccount(username, {
    authenticator: first,
    deviceName: 'Laptop',
  });
  await registerAccount(username, {
    client,
    authenticator: second,
    deviceName: 'Phone',
  });
  return { client, first, second };
}

describe('renaming a passkey', () => {
  it('will not let one account rename another account’s passkey', async () => {
    const { client } = await accountWithTwoPasskeys('dev-alice');
    const { first } = await accountWithTwoPasskeys('dev-alice-2');

    const renamed = await client.postForm(
      `/devices/${encodeURIComponent(first.credentialIdB64)}/rename`,
      { deviceName: 'Someone else’s laptop' },
    );
    // That credential belongs to the other account, so it must not be found.
    assert.equal(renamed.status, 404);
  });

  it('renames a passkey on your own account', async () => {
    const { client, first } = await accountWithTwoPasskeys('dev-bob');

    const renamed = await client.postForm(
      `/devices/${encodeURIComponent(first.credentialIdB64)}/rename`,
      { deviceName: 'Work laptop' },
    );
    assert.equal(renamed.status, 302);

    const account = await client.getPage('/account');
    assert.match(account.text, /Work laptop/);
    assert.doesNotMatch(account.text, /<h3>\s*Laptop/);
  });
});

describe('revoking a passkey', () => {
  it('stops that passkey being able to sign in', async () => {
    const { client, second } = await accountWithTwoPasskeys('dev-carol');

    const revoked = await client.postForm(
      `/devices/${encodeURIComponent(second.credentialIdB64)}/revoke`,
      {},
    );
    assert.equal(revoked.status, 302);

    // The revoked passkey is no longer offered...
    const asked = await createClient().post('/webauthn/auth/options', {
      username: 'dev-carol',
    });
    const offered = asked.body.allowCredentials.map((entry) => entry.id);
    assert.ok(!offered.includes(second.credentialIdB64));

    // ...and is refused even when it presents itself anyway, because
    // allowCredentials is only a hint the client is free to ignore.
    const attempt = await signIn('dev-carol', second);
    assert.equal(attempt.verified.status, 400);
    assert.match(attempt.verified.body.error, /turned off/);
  });

  it('signs out the browser that was using the revoked passkey', async () => {
    const { client, first } = await accountWithTwoPasskeys('dev-dave');

    // The session was created by 'first', so revoking it must end the session
    // rather than only blocking the next sign-in.
    await client.postForm(
      `/devices/${encodeURIComponent(first.credentialIdB64)}/revoke`,
      {},
    );

    const account = await client.getPage('/account');
    assert.equal(account.status, 302);
    assert.match(account.text + '', /signin/);
  });

  it('refuses to turn off the only passkey when there are no recovery codes', async () => {
    const { client, authenticator } = await registerAccount('dev-erin');

    const revoked = await client.postForm(
      `/devices/${encodeURIComponent(authenticator.credentialIdB64)}/revoke`,
      {},
    );
    assert.equal(revoked.status, 400);
    assert.match(revoked.text, /would lock you out/);

    // And it really is still usable.
    const attempt = await signIn('dev-erin', authenticator);
    assert.equal(attempt.verified.status, 200, attempt.verified.text);
  });

  it('allows it once recovery codes exist to come back with', async () => {
    const { client, authenticator } = await registerAccount('dev-frank');

    await client.postForm('/recovery-codes', {});
    const revoked = await client.postForm(
      `/devices/${encodeURIComponent(authenticator.credentialIdB64)}/revoke`,
      {},
    );
    assert.equal(revoked.status, 302);
  });

  it('refuses to revoke the same passkey twice', async () => {
    const { client, second } = await accountWithTwoPasskeys('dev-grace');
    const path = `/devices/${encodeURIComponent(second.credentialIdB64)}/revoke`;

    assert.equal((await client.postForm(path, {})).status, 302);
    const again = await client.postForm(path, {});
    assert.equal(again.status, 400);
    assert.match(again.text, /already been turned off/);
  });
});
