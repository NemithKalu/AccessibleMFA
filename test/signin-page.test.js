/**
 * The sign-in page's layout: one heading, the site named, and the controls
 * in the order the accessibility plan (docs/sign-in-plan.md, step 1) sets out.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workDir = mkdtempSync(join(tmpdir(), 'accessible-mfa-signin-page-'));
process.env.AMFA_DB_PATH = join(workDir, 'test.db');
process.env.PORT = '3995';
process.env.SESSION_SECRET = 'test-secret';

const { default: app } = await import('../src/app.js');
const { ORIGIN, RP_NAME } = await import('../src/config.js');

let server;

before(async () => {
  server = app.listen(Number(process.env.PORT));
  await new Promise((resolve) => server.once('listening', resolve));
});

after(() => {
  server.close();
  rmSync(workDir, { recursive: true, force: true });
});

async function getSignInPage() {
  const response = await fetch(`${ORIGIN}/signin`);
  return response.text();
}

describe('the sign-in page, as an anonymous visitor', () => {
  it('has exactly one h1', async () => {
    const html = await getSignInPage();
    const headings = html.match(/<h1[ >]/g) ?? [];
    assert.equal(headings.length, 1);
  });

  // Checked in the page itself, not just the <title>, which already carried
  // the name before this page named the site.
  it('names the site in the header and in the instruction', async () => {
    const html = await getSignInPage();
    assert.ok(
      html.includes(`<p class="site-name">${RP_NAME}</p>`),
      `expected the header to name "${RP_NAME}"`,
    );
    assert.match(html, new RegExp(`Sign in to the ${RP_NAME} with your passkey`));
  });

  it('reads in the planned order: notice, status, passkey, other method, guidance, username', async () => {
    const html = await getSignInPage();

    const notice = html.indexOf('What happens when you sign in');
    const status = html.indexOf('id="status"');
    const passkey = html.indexOf('Sign in with a passkey');
    const otherMethod = html.indexOf('Use another method');
    const guidance = html.indexOf('Read guidance');
    const username = html.indexOf('Sign in with your username instead');

    for (const [name, index] of [
      ['prompt notice', notice],
      ['status region', status],
      ['passkey button', passkey],
      ['other method link', otherMethod],
      ['read guidance button', guidance],
      ['username heading', username],
    ]) {
      assert.notEqual(index, -1, `expected to find the ${name}`);
    }

    assert.ok(notice < status, 'the notice should come before the status region');
    assert.ok(status < passkey, 'the status region should come right before the controls');
    assert.ok(passkey < otherMethod, '"Sign in with a passkey" should come before "Use another method"');
    assert.ok(otherMethod < guidance, '"Use another method" should come before "Read guidance"');
    assert.ok(guidance < username, 'the three controls should come before the username heading');
  });

  it('has a status region that is a polite live region', async () => {
    const html = await getSignInPage();
    const statusTag = html.match(/<p id="status"[^>]*>/)?.[0] ?? '';
    assert.ok(statusTag.includes('role="status"'), 'expected role="status"');
    assert.ok(statusTag.includes('aria-live="polite"'), 'expected aria-live="polite"');
  });

  it('keeps "Read guidance" hidden, since voice guidance is not built yet', async () => {
    const html = await getSignInPage();
    const button = html.match(/<button[^>]*id="read-guidance"[^>]*>/)?.[0] ?? '';
    assert.ok(button.includes('hidden'), 'expected the button to carry the hidden attribute');
  });

  it('labels the username input', async () => {
    const html = await getSignInPage();
    assert.match(html, /<label for="username">/);
    assert.match(html, /<input[^>]*id="username"/);
  });

  it('makes "Use another method" a real link, not a button', async () => {
    const html = await getSignInPage();
    const control = html.match(/<a[^>]*id="other-method-link"[^>]*>/)?.[0];
    assert.ok(control, 'expected an <a> with id="other-method-link"');
    assert.match(control, /href="\/recover"/);
  });
});
