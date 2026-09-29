/**
 * "Other ways to sign in" (docs/sign-in-plan.md, step 4): lists only the
 * routes that work today, carries a typed username across when it is valid,
 * and never reflects anything that is not already a valid username.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workDir = mkdtempSync(join(tmpdir(), 'accessible-mfa-signin-other-'));
process.env.AMFA_DB_PATH = join(workDir, 'test.db');
process.env.PORT = '3993'; // 3994-3999 are used by the other test files
process.env.SESSION_SECRET = 'test-secret';

const { default: app } = await import('../src/app.js');
const { ORIGIN } = await import('../src/config.js');
const { usernameFromQuery } = await import('../src/text.js');
const { registerAccount } = await import('./client.js');

let server;

before(async () => {
  server = app.listen(Number(process.env.PORT));
  await new Promise((resolve) => server.once('listening', resolve));
});

after(() => {
  server.close();
  rmSync(workDir, { recursive: true, force: true });
});

async function getOtherPage(query = '') {
  const response = await fetch(`${ORIGIN}/signin/other${query}`, { redirect: 'manual' });
  return { status: response.status, text: await response.text() };
}

describe('GET /signin/other', () => {
  it('has exactly one h1', async () => {
    const { text } = await getOtherPage();
    const headings = text.match(/<h1[ >]/g) ?? [];
    assert.equal(headings.length, 1);
  });

  it('has the three headings in order', async () => {
    const { text } = await getOtherPage();
    const another = text.indexOf('If your passkey is on another device or a security key');
    const lost = text.indexOf('If you have lost every device with a passkey');
    const noCode = text.indexOf('If you have no recovery code');

    for (const [name, index] of [
      ['another device heading', another],
      ['lost every device heading', lost],
      ['no recovery code heading', noCode],
    ]) {
      assert.notEqual(index, -1, `expected to find the ${name}`);
    }
    assert.ok(another < lost, 'the "another device" heading should come first');
    assert.ok(lost < noCode, 'the "lost every device" heading should come before "no recovery code"');
  });

  it('links back to /signin', async () => {
    const { text } = await getOtherPage();
    assert.match(text, /<a href="\/signin">Go back to signing in<\/a>/);
  });

  it('links to /recover with no query when no username is given', async () => {
    const { text } = await getOtherPage();
    assert.match(text, /<a href="\/recover">Use a recovery code<\/a>/);
  });

  it('carries a valid username through to the recovery link', async () => {
    const { text } = await getOtherPage('?username=Alice.Smith');
    assert.match(text, /<a href="\/recover\?username=alice\.smith">Use a recovery code<\/a>/);
  });

  it('drops an invalid username instead of reflecting it', async () => {
    for (const bad of ['<script>', 'a b', 'x', 'x'.repeat(40)]) {
      const { text } = await getOtherPage(`?username=${encodeURIComponent(bad)}`);
      assert.ok(!text.includes(bad), `expected "${bad}" not to be reflected anywhere in the page`);
      assert.match(text, /<a href="\/recover">Use a recovery code<\/a>/);
    }
  });

  it('redirects a signed-in visitor to /account', async () => {
    const { client } = await registerAccount('other-ways-alice');
    const response = await client.getPage('/signin/other');
    assert.equal(response.status, 302);
  });
});

describe('GET /recover with a username in the query', () => {
  async function getRecoverPage(query = '') {
    const response = await fetch(`${ORIGIN}/recover${query}`);
    return response.text();
  }

  it('pre-fills a valid username', async () => {
    const text = await getRecoverPage('?username=alice.smith');
    assert.match(text, /value="alice\.smith"/);
  });

  it('does not reflect an invalid username', async () => {
    const text = await getRecoverPage('?username=%3Cscript%3E');
    assert.ok(!text.includes('<script>'));
    assert.match(text, /value=""/);
  });
});

describe('usernameFromQuery', () => {
  it('accepts a valid username', () => {
    assert.equal(usernameFromQuery('alice.smith'), 'alice.smith');
  });

  it('lowercases and trims', () => {
    assert.equal(usernameFromQuery('  Alice.Smith  '), 'alice.smith');
  });

  it('drops an invalid username', () => {
    assert.equal(usernameFromQuery('<script>'), '');
    assert.equal(usernameFromQuery('a b'), '');
    assert.equal(usernameFromQuery('x'), '');
    assert.equal(usernameFromQuery('x'.repeat(40)), '');
  });

  it('drops undefined', () => {
    assert.equal(usernameFromQuery(undefined), '');
  });
});

describe('carrying the username back to the sign-in page', () => {
  it('the back link keeps a valid username', async () => {
    const { text } = await getOtherPage('?username=alice.smith');
    assert.match(text, /href="\/signin\?username=alice\.smith"/);
  });

  it('the back link has no query when there is no username', async () => {
    const { text } = await getOtherPage();
    assert.match(text, /href="\/signin">Go back to signing in/);
  });

  it('the sign-in page fills in the username and carries it on to "Use another method"', async () => {
    const response = await fetch(`${ORIGIN}/signin?username=alice.smith`);
    const text = await response.text();
    assert.match(text, /value="alice\.smith"/);
    assert.match(text, /id="other-method-link" href="\/signin\/other\?username=alice\.smith"/);
  });

  it('the sign-in page does not reflect an invalid username', async () => {
    const response = await fetch(`${ORIGIN}/signin?username=%3Cb%3Ehi`);
    const text = await response.text();
    assert.ok(!text.includes('<b>hi'));
    assert.match(text, /id="other-method-link" href="\/signin\/other"/);
  });
});

describe('the recovery-code steps', () => {
  it('are a numbered list, because their order matters', async () => {
    const { text } = await getOtherPage();
    const lost = text.indexOf('If you have lost every device with a passkey');
    const noCode = text.indexOf('If you have no recovery code');
    const section = text.slice(lost, noCode);
    assert.match(section, /<ol>/);
    assert.doesNotMatch(section, /<ul>/);
  });
});
