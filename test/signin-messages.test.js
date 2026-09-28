/**
 * Sign-in states and messages (docs/sign-in-plan.md, step 2).
 *
 * Two halves, in one file because they cover the same feature:
 *  - server-side: the passkey-prompt timeout and each named AuthError `code`
 *    the sign-in endpoints can produce, driven over real HTTP like flow.test.js.
 *  - browser-side: public/js/signin-messages.js is plain, DOM-free JavaScript,
 *    so it is loaded and exercised directly in Node with vm, with no browser
 *    involved at all.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const workDir = mkdtempSync(join(tmpdir(), 'accessible-mfa-signin-messages-'));
process.env.AMFA_DB_PATH = join(workDir, 'test.db');
process.env.PORT = '3994'; // 3995-3999 are used by the other test files
process.env.SESSION_SECRET = 'test-secret';

const { default: app } = await import('../src/app.js');
const { PASSKEY_PROMPT_TIMEOUT_MS, CHALLENGE_TTL_MS } = await import('../src/config.js');
const { SoftwareAuthenticator } = await import('./authenticator.js');
const { createClient, registerAccount, ORIGIN, RP_ID } = await import('./client.js');

// Loaded once, up top, so both halves of this file can use it: the
// server-side tests below use it for the drift check (spokenLine(code) must
// equal the server's own message, for every code except no-account), and the
// browser-side describe block further down exercises it directly.
function loadSignInMessages() {
  const source = readFileSync(join(projectRoot, 'public/js/signin-messages.js'), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.SignInMessages;
}

const SignInMessages = loadSignInMessages();

let server;

before(async () => {
  server = app.listen(Number(process.env.PORT));
  await new Promise((resolve) => server.once('listening', resolve));
});

after(() => {
  server.close();
  rmSync(workDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Server side
// ---------------------------------------------------------------------------

describe('the passkey prompt timeout', () => {
  it('is 5 minutes, and the challenge outlives it', () => {
    assert.equal(PASSKEY_PROMPT_TIMEOUT_MS, 5 * 60 * 1000);
    // Single use either way; this only bounds how long an unused challenge
    // may sit around, and it must outlast the prompt it protects.
    assert.ok(CHALLENGE_TTL_MS > PASSKEY_PROMPT_TIMEOUT_MS);
  });

  it('is handed to the browser on both registration and sign-in options', async () => {
    const registerOptions = await createClient().post('/webauthn/register/options', {
      username: 'msg-timeout-reg',
    });
    assert.equal(registerOptions.body.timeout, 300000);

    const authOptions = await createClient().post('/webauthn/auth/options', {});
    assert.equal(authOptions.body.timeout, 300000);
  });
});

describe('sign-in failure codes', () => {
  it('invalid-username, for a username that fails the pattern', async () => {
    const res = await createClient().post('/webauthn/auth/options', { username: '!!' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'invalid-username');
    assert.match(res.body.error, /^Sign-in was not completed\./);
    // Drift check: the spoken line must track the server's own wording.
    assert.equal(SignInMessages.spokenLine(res.body.code), res.body.error);
  });

  it('no-account, for a username with no matching account', async () => {
    const res = await createClient().post('/webauthn/auth/options', {
      username: 'msg-nobody-here',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'no-account');
    assert.match(res.body.error, /^Sign-in was not completed\./);
    // no-account is the one exception: the server message names the typed
    // username, and speech must never say a username out loud.
    assert.notEqual(SignInMessages.spokenLine('no-account'), res.body.error);
    assert.doesNotMatch(SignInMessages.spokenLine('no-account'), /msg-nobody-here/);
    assert.match(SignInMessages.spokenLine('no-account'), /the username you typed/);
  });

  it('no-usable-passkeys, once the only passkey has been revoked', async () => {
    const { client, authenticator } = await registerAccount('msg-noneleft');

    // Recovery codes have to exist before the only passkey can be revoked —
    // see devices.test.js — otherwise the revoke itself is refused.
    await client.postForm('/recovery-codes', {});
    const revoked = await client.postForm(
      `/devices/${encodeURIComponent(authenticator.credentialIdB64)}/revoke`,
      {},
    );
    assert.equal(revoked.status, 302, revoked.text);

    const res = await createClient().post('/webauthn/auth/options', {
      username: 'msg-noneleft',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'no-usable-passkeys');
    assert.match(res.body.error, /^Sign-in was not completed\./);
    assert.equal(SignInMessages.spokenLine(res.body.code), res.body.error);
  });

  it('request-expired, replaying a challenge that was already consumed', async () => {
    const authenticator = new SoftwareAuthenticator();
    await registerAccount('msg-replay', { authenticator });

    const client = createClient();
    const options = await client.post('/webauthn/auth/options', { username: 'msg-replay' });
    const assertion = authenticator.authenticate({
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.body.challenge,
    });

    const first = await client.post('/webauthn/auth/verify', assertion);
    assert.equal(first.status, 200, first.text);

    // Same body, same session: the challenge was deleted the moment the
    // first verification read it, so nothing is left for the replay to match.
    const replay = await client.post('/webauthn/auth/verify', assertion);
    assert.equal(replay.status, 400);
    assert.equal(replay.body.code, 'request-expired');
    assert.match(replay.body.error, /^Sign-in was not completed\./);
    assert.equal(SignInMessages.spokenLine(replay.body.code), replay.body.error);
  });

  it('not-verified, when the device did not confirm the user', async () => {
    const authenticator = new SoftwareAuthenticator();
    await registerAccount('msg-noverify', { authenticator });

    const client = createClient();
    const options = await client.post('/webauthn/auth/options', { username: 'msg-noverify' });
    const assertion = authenticator.authenticate({
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.body.challenge,
      userVerified: false,
    });
    const verified = await client.post('/webauthn/auth/verify', assertion);

    assert.equal(verified.status, 400);
    assert.equal(verified.body.code, 'not-verified');
    assert.match(verified.body.error, /^Sign-in was not completed\./);
    assert.equal(SignInMessages.spokenLine(verified.body.code), verified.body.error);
  });

  it('account-mismatch, when the user handle names a different account', async () => {
    const mallory = new SoftwareAuthenticator();
    const victim = new SoftwareAuthenticator();

    const malloryClient = createClient();
    const malloryOptions = await malloryClient.post('/webauthn/register/options', {
      username: 'msg-mallory',
    });
    await malloryClient.post(
      '/webauthn/register/verify',
      mallory.register({ rpId: RP_ID, origin: ORIGIN, challenge: malloryOptions.body.challenge }),
    );

    const victimClient = createClient();
    const victimOptions = await victimClient.post('/webauthn/register/options', {
      username: 'msg-victim',
    });
    await victimClient.post(
      '/webauthn/register/verify',
      victim.register({ rpId: RP_ID, origin: ORIGIN, challenge: victimOptions.body.challenge }),
    );

    const authClient = createClient();
    const authOptions = await authClient.post('/webauthn/auth/options', {
      username: 'msg-mallory',
    });
    const assertion = mallory.authenticate({
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: authOptions.body.challenge,
      userHandle: victimOptions.body.user.id, // claims the victim's account
    });
    const verified = await authClient.post('/webauthn/auth/verify', assertion);

    assert.equal(verified.status, 400);
    assert.equal(verified.body.code, 'account-mismatch');
    assert.match(verified.body.error, /^Sign-in was not completed\./);
    assert.equal(SignInMessages.spokenLine(verified.body.code), verified.body.error);
  });

  it('passkey-turned-off, when it presents itself after being revoked', async () => {
    const first = new SoftwareAuthenticator();
    const second = new SoftwareAuthenticator();
    const { client } = await registerAccount('msg-turnedoff', {
      authenticator: first,
      deviceName: 'Laptop',
    });
    await registerAccount('msg-turnedoff', { client, authenticator: second, deviceName: 'Phone' });

    const revoked = await client.postForm(
      `/devices/${encodeURIComponent(second.credentialIdB64)}/revoke`,
      {},
    );
    assert.equal(revoked.status, 302, revoked.text);

    const authClient = createClient();
    const options = await authClient.post('/webauthn/auth/options', {
      username: 'msg-turnedoff',
    });
    const assertion = second.authenticate({
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.body.challenge,
    });
    const verified = await authClient.post('/webauthn/auth/verify', assertion);

    assert.equal(verified.status, 400);
    assert.equal(verified.body.code, 'passkey-turned-off');
    assert.match(verified.body.error, /^Sign-in was not completed\./);
    assert.equal(SignInMessages.spokenLine(verified.body.code), verified.body.error);
  });

  it('possible-copy, when the signature counter goes backwards', async () => {
    const authenticator = new SoftwareAuthenticator();
    await registerAccount('msg-clone', { authenticator });

    // Two ordinary sign-ins first, so the stored counter is at 2.
    for (let i = 0; i < 2; i += 1) {
      const client = createClient();
      const options = await client.post('/webauthn/auth/options', { username: 'msg-clone' });
      const assertion = authenticator.authenticate({
        rpId: RP_ID,
        origin: ORIGIN,
        challenge: options.body.challenge,
      });
      const verified = await client.post('/webauthn/auth/verify', assertion);
      assert.equal(verified.status, 200, verified.text);
    }

    const client = createClient();
    const options = await client.post('/webauthn/auth/options', { username: 'msg-clone' });
    const clone = authenticator.authenticate({
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: options.body.challenge,
      counter: 1, // reports a counter lower than the stored value of 2
    });
    const verified = await client.post('/webauthn/auth/verify', clone);

    assert.equal(verified.status, 400);
    assert.equal(verified.body.code, 'possible-copy');
    assert.match(verified.body.error, /^Sign-in was not completed\./);
    assert.equal(SignInMessages.spokenLine(verified.body.code), verified.body.error);
  });
});

// ---------------------------------------------------------------------------
// Browser side: public/js/signin-messages.js, loaded and run in plain Node
// ---------------------------------------------------------------------------

describe('SignInMessages.describeFailure (loaded with vm, no DOM involved)', () => {
  it('exists and exposes the fixed state lines', () => {
    assert.ok(SignInMessages, 'expected window.SignInMessages to be set');
    assert.equal(SignInMessages.STATES.opening, 'Opening device verification.');
    assert.equal(SignInMessages.STATES.checking, 'Checking sign-in.');
  });

  it('uses a server error message as-is, and focuses username for a username-shaped code', () => {
    const message =
      'Sign-in was not completed. There is no account called “ghost”. Check the spelling, or create an account.';
    const outcome = SignInMessages.describeFailure({
      error: { kind: 'server', status: 400, code: 'no-account', message },
      stage: 'options',
    });
    assert.equal(outcome.message, message);
    assert.equal(outcome.focus, 'username');
    assert.equal(outcome.key, 'no-account');
  });

  it('sends focus back to the retry button for a non-username server code', () => {
    const outcome = SignInMessages.describeFailure({
      error: { kind: 'server', status: 400, code: 'unknown-passkey', message: 'x' },
      stage: 'verify',
    });
    assert.equal(outcome.focus, 'retry');
    assert.equal(outcome.key, 'unknown-passkey');
  });

  it('describes an uncoded 5xx as a fault on the website’s side', () => {
    const outcome = SignInMessages.describeFailure({
      error: { kind: 'server', status: 500 },
      stage: 'verify',
    });
    assert.match(outcome.message, /^Sign-in was not completed\./);
    assert.match(outcome.message, /website's side/);
    assert.equal(outcome.focus, 'retry');
    assert.equal(outcome.key, 'server-fault');
  });

  it('describes an uncoded 4xx as the website’s fault too, never the device’s', () => {
    const outcome = SignInMessages.describeFailure({
      error: { kind: 'server', status: 400, message: 'Some older message' },
      stage: 'options',
    });
    assert.match(outcome.message, /website's side/);
    assert.doesNotMatch(outcome.message, /device/);
    assert.equal(outcome.key, 'server-fault');
  });

  it('describes a network failure before the prompt as nothing having changed', () => {
    const outcome = SignInMessages.describeFailure({ error: { kind: 'network' }, stage: 'options' });
    assert.match(outcome.message, /^Sign-in was not completed\./);
    assert.match(outcome.message, /could not be reached/);
    assert.equal(outcome.key, 'network-options');
  });

  it('describes a network failure during verify as an unknown outcome, not a plain failure', () => {
    const outcome = SignInMessages.describeFailure({ error: { kind: 'network' }, stage: 'verify' });
    assert.match(outcome.message, /Sign-in could not be confirmed because the connection was lost/);
    assert.match(outcome.message, /may not be signed in/);
    assert.equal(outcome.key, 'network-verify');
  });

  it('treats a NotAllowedError near the timeout as a timeout, naming minutes built from timeoutMs', () => {
    const timeoutMs = 5 * 60 * 1000;
    const outcome = SignInMessages.describeFailure({
      error: { name: 'NotAllowedError' },
      stage: 'prompt',
      elapsedMs: timeoutMs - 1000, // within the 10s tolerance
      timeoutMs,
    });
    assert.match(outcome.message, /timed out after 5 minutes/);
    assert.equal(outcome.key, 'timed-out');
  });

  it('builds the minutes in that message from timeoutMs, not a hard-coded 5', () => {
    const timeoutMs = 2 * 60 * 1000;
    const outcome = SignInMessages.describeFailure({
      error: { name: 'NotAllowedError' },
      stage: 'prompt',
      elapsedMs: timeoutMs,
      timeoutMs,
    });
    assert.match(outcome.message, /timed out after 2 minutes/);
  });

  it('treats a NotAllowedError well before the timeout as a cancellation, not a timeout', () => {
    const timeoutMs = 5 * 60 * 1000;
    const outcome = SignInMessages.describeFailure({
      error: { name: 'NotAllowedError' },
      stage: 'prompt',
      elapsedMs: 2000,
      timeoutMs,
    });
    assert.match(outcome.message, /closed before it finished/);
    assert.doesNotMatch(outcome.message, /timed out/);
    assert.equal(outcome.key, 'closed');
  });

  it('describes an AbortError as the request having been stopped', () => {
    const outcome = SignInMessages.describeFailure({ error: { name: 'AbortError' }, stage: 'prompt' });
    assert.match(outcome.message, /stopped before it finished/);
    assert.equal(outcome.key, 'aborted');
  });

  it('describes a SecurityError as the page address being unusable for passkeys', () => {
    const outcome = SignInMessages.describeFailure({ error: { name: 'SecurityError' }, stage: 'prompt' });
    assert.match(outcome.message, /address can't be used with passkeys/);
    assert.equal(outcome.key, 'security');
  });

  it('falls back to one honest catch-all for anything unrecognised', () => {
    const outcome = SignInMessages.describeFailure({
      error: { name: 'ConstraintError' },
      stage: 'prompt',
    });
    assert.match(outcome.message, /^Sign-in was not completed\./);
    assert.match(outcome.message, /could not finish the passkey request/);
    assert.equal(outcome.focus, 'retry');
    assert.equal(outcome.key, 'device-failed');
  });
});

describe('SignInMessages.spokenLine (the fixed catalogue speech is allowed to read from)', () => {
  const STATE_KEYS = ['intro', 'opening', 'checking', 'success', 'unsupported', 'missingUsername'];
  const CLIENT_FAILURE_KEYS = [
    'server-fault',
    'network-options',
    'network-verify',
    'timed-out',
    'closed',
    'aborted',
    'security',
    'device-failed',
  ];
  const SERVER_CODES = [
    'invalid-username',
    'no-account',
    'no-usable-passkeys',
    'request-expired',
    'request-mismatch',
    'unknown-passkey',
    'passkey-turned-off',
    'account-mismatch',
    'not-verified',
    'not-present',
    'possible-copy',
    'wrong-origin',
    'wrong-site',
    'not-verified-other',
  ];

  it('has a non-empty line for every state, client-failure and server-code key', () => {
    for (const key of [...STATE_KEYS, ...CLIENT_FAILURE_KEYS, ...SERVER_CODES]) {
      const line = SignInMessages.spokenLine(key);
      assert.equal(typeof line, 'string', `expected a spoken line for "${key}"`);
      assert.ok(line.length > 0, `expected a non-empty spoken line for "${key}"`);
    }
  });

  it('never says a username out loud for no-account', () => {
    const line = SignInMessages.spokenLine('no-account');
    assert.doesNotMatch(line, /called [“"]/, 'expected no quoted username placeholder');
    assert.match(line, /the username you typed/);
  });

  it('names the actual configured minutes in the timed-out line, not a hard-coded number', () => {
    // spokenLine('timed-out') is a fixed string (it can't take a runtime
    // arg), so this pins it to the real constant instead: if
    // PASSKEY_PROMPT_TIMEOUT_MS ever changes, this test fails loudly rather
    // than the spoken line quietly drifting from what the page actually does.
    const minutes = PASSKEY_PROMPT_TIMEOUT_MS / 60000;
    const line = SignInMessages.spokenLine('timed-out');
    assert.match(line, new RegExp(`${minutes} minutes`));
  });

  it('returns null for a key that is not in the fixed list', () => {
    assert.equal(SignInMessages.spokenLine('not-a-real-key'), null);
    assert.equal(SignInMessages.spokenLine(undefined), null);
  });
});
