/**
 * A browser-like test client: one cookie jar, JSON or form posts, pages.
 *
 * Import this *after* the test file has set AMFA_DB_PATH and PORT, because it
 * reads the app's config at load time.
 */

import assert from 'node:assert/strict';
import { SoftwareAuthenticator } from './authenticator.js';

const { ORIGIN, RP_ID } = await import('../src/config.js');

export { ORIGIN, RP_ID };

export function createClient() {
  let cookie = null;
  return {
    get cookie() {
      return cookie;
    },
    /** POST JSON, as the page scripts do. */
    async post(path, body) {
      return send(path, {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
    },
    /** POST a plain HTML form, as the device and recovery pages do. */
    async postForm(path, fields) {
      return send(path, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields ?? {}).toString(),
      });
    },
    async getPage(path) {
      const response = await fetch(`${ORIGIN}${path}`, {
        headers: cookie ? { Cookie: cookie } : {},
        redirect: 'manual',
      });
      return { status: response.status, text: await response.text() };
    },
  };

  async function send(path, init) {
    const response = await fetch(`${ORIGIN}${path}`, {
      method: 'POST',
      ...init,
      headers: { ...init.headers, ...(cookie ? { Cookie: cookie } : {}) },
      redirect: 'manual',
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];

    const text = await response.text();
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = {}; // a redirect or an HTML page, not JSON
    }
    return { status: response.status, location: response.headers.get('location'), text, body };
  }
}

/** Register a brand new account, or add a passkey to a signed-in client. */
export async function registerAccount(username, options = {}) {
  const client = options.client ?? createClient();
  const authenticator = options.authenticator ?? new SoftwareAuthenticator();
  const deviceName = options.deviceName ?? 'Test authenticator';

  const asked = await client.post('/webauthn/register/options', { username, deviceName });
  assert.equal(asked.status, 200, asked.text);

  const attestation = authenticator.register({
    rpId: RP_ID,
    origin: ORIGIN,
    challenge: asked.body.challenge,
  });
  const verified = await client.post('/webauthn/register/verify', attestation);
  assert.equal(verified.status, 200, verified.text);

  return { client, authenticator, credentialId: authenticator.credentialIdB64 };
}

/** Sign in with a username and an already-registered authenticator. */
export async function signIn(username, authenticator, client = createClient()) {
  const asked = await client.post('/webauthn/auth/options', { username });
  if (asked.status !== 200) return { client, verified: asked };

  const assertion = authenticator.authenticate({
    rpId: RP_ID,
    origin: ORIGIN,
    challenge: asked.body.challenge,
  });
  return { client, verified: await client.post('/webauthn/auth/verify', assertion) };
}
