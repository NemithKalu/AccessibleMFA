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

  it('reads in the planned order: notice, status, passkey, other method, guidance, stop guidance, username', async () => {
    const html = await getSignInPage();

    const notice = html.indexOf('What happens when you sign in');
    const status = html.indexOf('id="status"');
    const passkey = html.indexOf('Sign in with a passkey');
    const otherMethod = html.indexOf('Use another method');
    const guidance = html.indexOf('Read guidance');
    const stopGuidance = html.indexOf('Stop guidance');
    const username = html.indexOf('Sign in with your username instead');

    for (const [name, index] of [
      ['prompt notice', notice],
      ['status region', status],
      ['passkey button', passkey],
      ['other method link', otherMethod],
      ['read guidance button', guidance],
      ['stop guidance button', stopGuidance],
      ['username heading', username],
    ]) {
      assert.notEqual(index, -1, `expected to find the ${name}`);
    }

    assert.ok(notice < status, 'the notice should come before the status region');
    assert.ok(status < passkey, 'the status region should come right before the controls');
    assert.ok(passkey < otherMethod, '"Sign in with a passkey" should come before "Use another method"');
    assert.ok(otherMethod < guidance, '"Use another method" should come before "Read guidance"');
    assert.ok(guidance < stopGuidance, '"Read guidance" should come before "Stop guidance"');
    assert.ok(stopGuidance < username, 'the controls should come before the username heading');
  });

  it('has a status region that is a polite live region', async () => {
    const html = await getSignInPage();
    const statusTag = html.match(/<p id="status"[^>]*>/)?.[0] ?? '';
    assert.ok(statusTag.includes('role="status"'), 'expected role="status"');
    assert.ok(statusTag.includes('aria-live="polite"'), 'expected aria-live="polite"');
  });

  it('keeps both voice-guidance buttons hidden until script un-hides them', async () => {
    const html = await getSignInPage();
    const readButton = html.match(/<button[^>]*id="read-guidance"[^>]*>/)?.[0] ?? '';
    assert.ok(readButton.includes('hidden'), 'expected "Read guidance" to carry the hidden attribute');
    const stopButton = html.match(/<button[^>]*id="stop-guidance"[^>]*>/)?.[0] ?? '';
    assert.ok(stopButton.includes('hidden'), 'expected "Stop guidance" to carry the hidden attribute');
  });

  it('has a written, hidden-by-default guidance note that is its own polite live region (AR-05)', async () => {
    const html = await getSignInPage();
    const note = html.match(/<p[^>]*id="guidance-note"[^>]*>/)?.[0] ?? '';
    assert.ok(note, 'expected a guidance note element');
    assert.ok(note.includes('hidden'), 'expected the note to carry the hidden attribute');
    assert.ok(note.includes('role="status"'), 'expected role="status" on the guidance note');
    assert.ok(note.includes('aria-live="polite"'), 'expected aria-live="polite" on the guidance note');
  });

  it('loads the sign-in scripts in order: messages, then voice guidance, then the page script', async () => {
    const html = await getSignInPage();
    const messages = html.indexOf('/js/signin-messages.js');
    const voiceGuidance = html.indexOf('/js/voice-guidance.js');
    const signin = html.indexOf('/js/signin.js');

    for (const [name, index] of [
      ['signin-messages.js', messages],
      ['voice-guidance.js', voiceGuidance],
      ['signin.js', signin],
    ]) {
      assert.notEqual(index, -1, `expected to find a script tag for ${name}`);
    }

    assert.ok(messages < voiceGuidance, 'signin-messages.js should load before voice-guidance.js');
    assert.ok(voiceGuidance < signin, 'voice-guidance.js should load before signin.js');
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
