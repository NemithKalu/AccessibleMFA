/**
 * Site-wide accessibility regression check (docs/sign-in-plan.md, step 6,
 * part B): every rendered page is checked against the same dozen structural
 * rules from CLAUDE.md's accessibility section — one heading, a labelled
 * input, a reachable skip link, and so on — using plain string/regex parsing.
 * No new dependency, no real DOM: good enough for the shape of this markup,
 * and it is exactly what makes a template regression fail loudly here rather
 * than being caught by a human days later.
 *
 * `<script>` bodies and HTML comments are stripped before most of the checks
 * run, so neither can accidentally satisfy or break a rule — several of the
 * comments in this app's templates literally contain words like
 * `aria-live="polite"` as commentary. Rule 12 is the one exception: it has to
 * look at the (comment-stripped, but script-tag-intact) markup to see which
 * scripts a page actually loads.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workDir = mkdtempSync(join(tmpdir(), 'accessible-mfa-semantics-'));
process.env.AMFA_DB_PATH = join(workDir, 'test.db');
process.env.PORT = '3992';
process.env.SESSION_SECRET = 'test-secret';

const { default: app } = await import('../src/app.js');
const { createClient, registerAccount } = await import('./client.js');

let server;

// Filled in by `before`, read by the `it`s below — see the note above the
// PAGES list about why the fetching happens in a hook rather than up top.
const pages = {};

before(async () => {
  server = app.listen(Number(process.env.PORT));
  await new Promise((resolve) => server.once('listening', resolve));

  // Anonymous pages.
  const anon = createClient();
  pages['GET /'] = (await anon.getPage('/')).text;
  pages['GET /signin'] = (await anon.getPage('/signin')).text;
  pages['GET /signin/other'] = (await anon.getPage('/signin/other')).text;
  pages['GET /recover'] = (await anon.getPage('/recover')).text;
  pages['GET /register'] = (await anon.getPage('/register')).text;
  pages['GET /no-such-page (404)'] = (await anon.getPage('/no-such-page')).text;

  // A full session: a freshly registered account.
  const { client: fullClient } = await registerAccount('sem-full');
  pages['GET /account'] = (await fullClient.getPage('/account')).text;
  pages['GET /recovery-codes'] = (await fullClient.getPage('/recovery-codes')).text;
  // The page shown right after generating codes is a different render (it
  // lists the plaintext codes, once) from the same route.
  pages['POST /recovery-codes (the page listing the codes)'] = (
    await fullClient.postForm('/recovery-codes', {})
  ).text;
  pages['GET /activity'] = (await fullClient.getPage('/activity')).text;

  // A restricted recovery session, following the same approach as
  // test/recovery.test.js: register an account, mint recovery codes, then
  // spend one from a fresh browser that never had a passkey.
  const { client: ownerClient } = await registerAccount('sem-restricted', {
    deviceName: 'Test device',
  });
  const codesPage = await ownerClient.postForm('/recovery-codes', {});
  const codes = [...codesPage.text.matchAll(/<code>([A-Z0-9-]+)<\/code>/g)].map((m) => m[1]);
  const restrictedClient = createClient();
  const started = await restrictedClient.postForm('/recover', {
    username: 'sem-restricted',
    code: codes[0],
  });
  assert.equal(started.status, 302, 'expected the recovery code to be accepted');
  pages['GET /recover/status (restricted session)'] = (
    await restrictedClient.getPage('/recover/status')
  ).text;
  pages['GET /account (restricted session)'] = (await restrictedClient.getPage('/account')).text;
});

after(() => {
  server.close();
  rmSync(workDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Small, dependency-free HTML helpers. All regex-based on purpose (no DOM),
// which is enough for markup this simple and keeps the test itself readable
// without pulling in a parser.
// ---------------------------------------------------------------------------

/** Strips comments only — used where a page's loaded scripts still matter. */
function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/** Strips comments and whole `<script>...</script>` blocks. */
function stripNoise(html) {
  return stripComments(html).replace(/<script[\s\S]*?<\/script>/gi, '');
}

/** One attribute's value from a tag's raw attribute string, "" or '' quoted. */
function attrValue(attrs, name) {
  const doubleQuoted = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, 'i'));
  if (doubleQuoted) return doubleQuoted[1];
  const singleQuoted = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*'([^']*)'`, 'i'));
  return singleQuoted ? singleQuoted[1] : null;
}

function hasBooleanAttr(attrs, name) {
  return new RegExp(`(?:^|\\s)${name}(?:\\s|=|$)`, 'i').test(attrs);
}

/** Every `<tag ...>` opening tag's raw attribute string, in document order. */
function openTags(html, tagName) {
  const regex = new RegExp(`<${tagName}\\b([^>]*)>`, 'gi');
  const out = [];
  let match;
  while ((match = regex.exec(html))) out.push({ attrs: match[1], index: match.index });
  return out;
}

/** Every `<tag ...>...</tag>` element (no nesting of the same tag assumed). */
function elements(html, tagName) {
  const regex = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  const out = [];
  let match;
  while ((match = regex.exec(html))) {
    out.push({ attrs: match[1], inner: match[2], index: match.index });
  }
  return out;
}

function textOf(inner) {
  return inner
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** All ids present anywhere in the page. */
function idsIn(html) {
  const ids = [];
  const regex = /\bid\s*=\s*"([^"]*)"/gi;
  let match;
  while ((match = regex.exec(html))) if (match[1]) ids.push(match[1]);
  return ids;
}

/** Every id referenced by aria-describedby / aria-labelledby / <label for>. */
function referencedIds(html) {
  const refs = [];
  for (const attrName of ['aria-describedby', 'aria-labelledby']) {
    const regex = new RegExp(`${attrName}\\s*=\\s*"([^"]*)"`, 'gi');
    let match;
    while ((match = regex.exec(html))) {
      for (const id of match[1].split(/\s+/).filter(Boolean)) refs.push({ attrName, id });
    }
  }
  for (const label of elements(html, 'label')) {
    const forId = attrValue(label.attrs, 'for');
    if (forId) refs.push({ attrName: 'label for', id: forId });
  }
  return refs;
}

/**
 * The first element in `body` that a Tab key would actually stop on: an
 * `<a href>`, a `<button>`, an `<input>` (not type="hidden"), a `<select>` or
 * a `<textarea>`, none of them `hidden`, `disabled`, or pulled out of the tab
 * order with `tabindex="-1"`.
 */
function firstFocusable(body) {
  const regex = /<(a|button|input|select|textarea)\b([^>]*)>/gi;
  let match;
  while ((match = regex.exec(body))) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    if (hasBooleanAttr(attrs, 'hidden')) continue;
    if (hasBooleanAttr(attrs, 'disabled')) continue;
    if (attrValue(attrs, 'tabindex') === '-1') continue;
    if (tag === 'input' && (attrValue(attrs, 'type') ?? '').toLowerCase() === 'hidden') continue;
    if (tag === 'a' && attrValue(attrs, 'href') === null) continue; // not a real link
    return { tag, attrs };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The pages under test.
// ---------------------------------------------------------------------------

const PAGE_NAMES = [
  'GET /',
  'GET /signin',
  'GET /signin/other',
  'GET /recover',
  'GET /register',
  'GET /no-such-page (404)',
  'GET /account',
  'GET /recovery-codes',
  'POST /recovery-codes (the page listing the codes)',
  'GET /activity',
  'GET /recover/status (restricted session)',
  'GET /account (restricted session)',
];

for (const pageName of PAGE_NAMES) {
  describe(`page semantics: ${pageName}`, () => {
    // Recomputed per it() rather than shared, so one test's mistake can't
    // leak state into another — these are cheap regex passes over one page.
    function html() {
      const raw = pages[pageName];
      assert.ok(raw, `expected ${pageName} to have been fetched in before()`);
      return raw;
    }

    it('rule 1: is <html lang="en">', () => {
      const clean = stripNoise(html());
      assert.match(clean, /<html\b[^>]*\blang\s*=\s*"en"/i);
    });

    it('rule 2: has a non-empty <title>', () => {
      const clean = stripNoise(html());
      const match = clean.match(/<title>([\s\S]*?)<\/title>/i);
      assert.ok(match, 'expected a <title> element');
      assert.ok(match[1].trim().length > 0, 'expected the <title> to have text');
    });

    it('rule 3: has exactly one <h1>', () => {
      const clean = stripNoise(html());
      const h1s = clean.match(/<h1[\s>]/gi) ?? [];
      assert.equal(h1s.length, 1, `expected exactly one <h1>, found ${h1s.length}`);
    });

    it('rule 4: heading levels never skip on the way down', () => {
      const clean = stripNoise(html());
      const levels = [...clean.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
      for (let i = 1; i < levels.length; i += 1) {
        assert.ok(
          levels[i] <= levels[i - 1] + 1,
          `heading sequence ${levels.join(' > ')} skips from h${levels[i - 1]} to h${levels[i]}`,
        );
      }
    });

    it('rule 5: the skip link is the first focusable element, and #main exists', () => {
      const clean = stripNoise(html());
      const bodyMatch = clean.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      const body = bodyMatch ? bodyMatch[1] : clean;

      const first = firstFocusable(body);
      assert.ok(first, 'expected at least one focusable element in <body>');
      assert.equal(first.tag, 'a', 'expected the first focusable element to be the skip link');
      assert.match(first.attrs, /class\s*=\s*"skip-link"/);
      assert.equal(attrValue(first.attrs, 'href'), '#main');

      assert.ok(idsIn(clean).includes('main'), 'expected an element with id="main"');
    });

    it('rule 6: every non-hidden input is labelled', () => {
      const clean = stripNoise(html());
      const labelFors = new Set(
        elements(clean, 'label')
          .map((label) => attrValue(label.attrs, 'for'))
          .filter(Boolean),
      );

      for (const input of openTags(clean, 'input')) {
        const type = (attrValue(input.attrs, 'type') ?? 'text').toLowerCase();
        if (type === 'hidden') continue;

        const id = attrValue(input.attrs, 'id');
        const ariaLabel = attrValue(input.attrs, 'aria-label');
        const ariaLabelledby = attrValue(input.attrs, 'aria-labelledby');

        const labelled =
          (id && labelFors.has(id)) ||
          (ariaLabel && ariaLabel.trim()) ||
          (ariaLabelledby && ariaLabelledby.trim());

        assert.ok(
          labelled,
          `input ${JSON.stringify(input.attrs.trim())} has no <label for>, aria-label or aria-labelledby`,
        );
      }
    });

    it('rule 7: every button has non-empty text or an aria-label', () => {
      const clean = stripNoise(html());
      for (const button of elements(clean, 'button')) {
        const text = textOf(button.inner);
        const ariaLabel = attrValue(button.attrs, 'aria-label');
        assert.ok(
          text.length > 0 || (ariaLabel && ariaLabel.trim().length > 0),
          `button ${JSON.stringify(button.attrs.trim())} has no visible text and no aria-label`,
        );
      }
    });

    it('rule 8: every referenced id (aria-describedby, aria-labelledby, label for) exists', () => {
      const clean = stripNoise(html());
      const ids = new Set(idsIn(clean));
      for (const ref of referencedIds(clean)) {
        assert.ok(ids.has(ref.id), `${ref.attrName}="${ref.id}" points at an id that doesn't exist`);
      }
    });

    it('rule 9: no id appears twice', () => {
      const clean = stripNoise(html());
      const ids = idsIn(clean);
      const seen = new Set();
      const duplicates = new Set();
      for (const id of ids) {
        if (seen.has(id)) duplicates.add(id);
        seen.add(id);
      }
      assert.equal(duplicates.size, 0, `duplicate id(s): ${[...duplicates].join(', ')}`);
    });

    it('rule 10: no positive tabindex', () => {
      const clean = stripNoise(html());
      const values = [...clean.matchAll(/tabindex\s*=\s*"?(-?\d+)"?/gi)].map((m) => Number(m[1]));
      for (const value of values) {
        assert.ok(value === 0 || value === -1, `found tabindex="${value}", only 0 or -1 are allowed`);
      }
    });

    it('rule 11: every link has real text', () => {
      const clean = stripNoise(html());
      const banned = new Set(['click here', 'here', 'more']);
      for (const link of elements(clean, 'a')) {
        if (attrValue(link.attrs, 'href') === null) continue; // not a real link
        const text = textOf(link.inner);
        assert.ok(text.length > 0, `link ${JSON.stringify(link.attrs.trim())} has no text`);
        assert.ok(
          !banned.has(text.toLowerCase()),
          `link text "${text}" is not descriptive out of context`,
        );
      }
    });

    it('rule 12: any /js/ page script implies the #status live region', () => {
      // Only comments are stripped here — the whole point is to see which
      // <script src> tags the page actually loads.
      const commentsStripped = stripComments(html());
      const scriptSrcs = [...commentsStripped.matchAll(/<script\b[^>]*\bsrc\s*=\s*"([^"]*)"/gi)].map(
        (m) => m[1],
      );
      const loadsPageScript = scriptSrcs.some((src) => src.startsWith('/js/'));
      if (!loadsPageScript) return; // nothing to check on a script-free page

      const clean = stripNoise(html());
      const statusTag = clean.match(/<[^>]*\bid\s*=\s*"status"[^>]*>/i)?.[0];
      assert.ok(statusTag, 'page loads a /js/ script but has no #status element');
      assert.match(statusTag, /role\s*=\s*"status"/);
      assert.match(statusTag, /aria-live\s*=\s*"polite"/);
    });
  });
}
