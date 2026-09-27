/**
 * Recovery codes: generation, single use, and who is allowed to create them.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workDir = mkdtempSync(join(tmpdir(), 'accessible-mfa-codes-'));
process.env.AMFA_DB_PATH = join(workDir, 'test.db');
process.env.PORT = '3998';
process.env.SESSION_SECRET = 'test-secret';

const { default: app } = await import('../src/app.js');
const { ORIGIN, RP_ID } = await import('../src/config.js');
const { SoftwareAuthenticator } = await import('./authenticator.js');
const codes = await import('../src/recovery-codes.js');

let server;

before(async () => {
  server = app.listen(Number(process.env.PORT));
  await new Promise((resolve) => server.once('listening', resolve));
});

after(() => {
  server.close();
  rmSync(workDir, { recursive: true, force: true });
});

/** A signed-in browser: cookie jar, forms and pages. */
async function signedInClient(username) {
  let cookie = null;
  const client = {
    async post(path, body, asForm = false) {
      const response = await fetch(`${ORIGIN}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': asForm ? 'application/x-www-form-urlencoded' : 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: asForm ? new URLSearchParams(body ?? {}).toString() : JSON.stringify(body ?? {}),
        redirect: 'manual',
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await response.text();
      return { status: response.status, text };
    },
    async getPage(path) {
      const response = await fetch(`${ORIGIN}${path}`, {
        headers: cookie ? { Cookie: cookie } : {},
        redirect: 'manual',
      });
      return { status: response.status, text: await response.text() };
    },
  };

  const authenticator = new SoftwareAuthenticator();
  const options = await client.post('/webauthn/register/options', {
    username,
    deviceName: 'Test authenticator',
  });
  const attestation = authenticator.register({
    rpId: RP_ID,
    origin: ORIGIN,
    challenge: JSON.parse(options.text).challenge,
  });
  await client.post('/webauthn/register/verify', attestation);
  return client;
}

/** Pull the plaintext codes out of the one page that ever shows them. */
function extractCodes(html) {
  return [...html.matchAll(/<code>([A-Z0-9-]+)<\/code>/g)].map((match) => match[1]);
}

describe('generating recovery codes', () => {
  it('creates ten codes and shows them exactly once', async () => {
    const client = await signedInClient('rc-alice');

    const created = await client.post('/recovery-codes', {}, true);
    assert.equal(created.status, 200);
    const plaintext = extractCodes(created.text);
    assert.equal(plaintext.length, 10);

    // Revisiting the page must not reveal them again: only hashes were stored.
    const revisit = await client.getPage('/recovery-codes');
    assert.equal(extractCodes(revisit.text).length, 0);
    assert.match(revisit.text, /10<\/strong> unused/);
  });

  it('uses no characters that can be misheard or misread', async () => {
    // 0/O and 1/I/L are the pairs that cause trouble when a code is read out
    // loud or typed from a printout.
    for (const code of codes.generateCodes()) {
      assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
    }
  });

  it('replaces the old set, so an old code cannot be used later', async () => {
    const client = await signedInClient('rc-bob');

    const first = extractCodes((await client.post('/recovery-codes', {}, true)).text);
    const second = extractCodes((await client.post('/recovery-codes', {}, true)).text);

    assert.equal(second.length, 10);
    for (const code of first) assert.ok(!second.includes(code));
  });

  it('accepts a code however the user typed it', async () => {
    const hash = codes.hashCode('ABCDE-FGHJK');
    assert.equal(codes.hashCode('abcde fghjk'), hash);
    assert.equal(codes.hashCode('  abcdefghjk  '), hash);
  });
});

describe('who may create recovery codes', () => {
  it('turns an anonymous visitor away', async () => {
    const response = await fetch(`${ORIGIN}/recovery-codes`, { redirect: 'manual' });
    assert.equal(response.status, 302);
  });
});
