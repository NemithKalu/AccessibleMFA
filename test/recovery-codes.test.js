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
const { ORIGIN } = await import('../src/config.js');
const { registerAccount } = await import('./client.js');
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

/** Pull the plaintext codes out of the one page that ever shows them. */
function extractCodes(html) {
  return [...html.matchAll(/<code>([A-Z0-9-]+)<\/code>/g)].map((match) => match[1]);
}

describe('generating recovery codes', () => {
  it('creates ten codes and shows them exactly once', async () => {
    const { client } = await registerAccount('rc-alice');

    const created = await client.postForm('/recovery-codes', {});
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
    const { client } = await registerAccount('rc-bob');

    const first = extractCodes((await client.postForm('/recovery-codes', {})).text);
    const second = extractCodes((await client.postForm('/recovery-codes', {})).text);

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
