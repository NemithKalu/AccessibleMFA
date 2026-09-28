/**
 * WCAG 1.4.3 (text) and 1.4.11 (non-text) contrast, checked automatically.
 *
 * public/css/style.css keeps every colour as a named custom property on
 * :root. This test reads that block, computes the contrast ratio (WCAG 2.x
 * relative luminance) for each pair of tokens actually used together on a
 * page, and asserts it against the minimum that pair needs. The table below
 * was built by reading views/*.ejs and style.css to find every place text or
 * a control boundary sits on a background — not guessed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(projectRoot, 'public/css/style.css'), 'utf8');

/** sRGB channel -> linear light, per the WCAG 2.x formula (0.04045 threshold). */
function linearise(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a #rrggbb colour. */
function luminance(hex) {
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((h) =>
    linearise(parseInt(h, 16)),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colours: (L1+0.05)/(L2+0.05), lighter first. */
function contrast(hexA, hexB) {
  const [l1, l2] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Pull every `--token: #hex;` declaration out of the :root block in the
// actual stylesheet, so this test fails loudly if a colour is renamed and
// nobody updates it here — it reads the real file, not a copy of it.
const rootBlock = css.match(/:root\s*{([^}]*)}/)[1];
const tokens = {};
for (const match of rootBlock.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
  tokens[match[1]] = match[2];
}

function ratioOf(tokenA, tokenB) {
  for (const name of [tokenA, tokenB]) {
    assert.ok(tokens[name], `expected style.css's :root to define --${name}`);
  }
  return contrast(tokens[tokenA], tokens[tokenB]);
}

// Every pair of tokens actually used together on a page, with the WCAG
// minimum it needs. 4.5:1 is 1.4.3 (normal text). 3:1 is 1.4.11 (a control's
// visual boundary, or a focus indicator, against the background next to it).
const pairs = [
  // Body copy, hints and links: every page, on the plain page background.
  ['body text on the page', 'ink', 'paper', 4.5],
  ['hint text on the page', 'muted', 'paper', 4.5],
  ['link text on the page', 'accent', 'paper', 4.5],
  // Primary button (e.g. "Sign in with a passkey"): paper label on accent fill.
  ['button label on an accent button', 'paper', 'accent', 4.5],
  // button.secondary / a.button-link: accent label on the plain page colour.
  ['secondary button or button-link label on the page', 'accent', 'paper', 4.5],
  // button[disabled] and button[aria-disabled="true"] share this rule (step
  // 5's fix): the label must stay legible while it reads "Waiting for your
  // device…", not dim to grey.
  ['busy/disabled button label on the page', 'accent', 'paper', 4.5],
  // button.danger ("Turn off <passkey>"): paper label on the error fill.
  ['danger button label on its error-coloured fill', 'paper', 'error', 4.5],
  // .tag ("Turned off", "This device, signed in now" in account.ejs).
  ['tag text on the page', 'muted', 'paper', 4.5],
  // #status / .status: the default (untoned) background used for "info"
  // messages such as "Opening device verification." and "Checking sign-in.".
  ['status text on its default (info) background', 'ink', 'panel', 4.5],
  ['status text on its success background', 'ink', 'success-bg', 4.5],
  ['status text on its error background', 'ink', 'error-bg', 4.5],
  // .prompt-notice ("What happens when you sign in" and its twins on the
  // register, account and recovery pages): body text on the soft panel.
  ['notice text on its soft panel background', 'ink', 'panel-soft', 4.5],
  // account.ejs's error-toned notice holds a link, "See the request and
  // cancel it" — link text on the error background, not the page.
  ["link text inside an error-toned notice", 'accent', 'error-bg', 4.5],
  // .skip-link, the first thing a keyboard user reaches on every page:
  // paper text on an ink fill.
  ['skip link text on its dark fill', 'paper', 'ink', 4.5],
  // input[type="text"]: the field's own border must be visible against the
  // page so a low-vision user can see where it is, not just where the text
  // goes (1.4.11 — this is the failure step 5 fixes).
  ["text field's border against the page", 'control-border', 'paper', 3],
  // a:focus-visible / button:focus-visible / etc. use outline-offset, which
  // draws the ring *outside* the element's own box — so even on the status
  // region (background: panel) or a button (background: accent), the ring
  // itself lands on whatever is behind the box, which on every page in this
  // app is the plain page background.
  ['focus outline against the page', 'focus', 'paper', 3],
  // The one exception: account.ejs's "See the request and cancel it" link
  // sits well inside the padding of a data-tone="error" .prompt-notice, so
  // its focus ring lands on that notice's own error-bg fill, not the page.
  ["focus outline against an error-toned notice's background", 'focus', 'error-bg', 3],
  // button.secondary / a.button-link / busy buttons keep their 2px accent
  // border regardless of state; it must be visible against the page too.
  ['secondary/busy button border against the page', 'accent', 'paper', 3],
];

describe('colour contrast (WCAG 1.4.3 and 1.4.11)', () => {
  for (const [description, fg, bg, minimum] of pairs) {
    it(`${description} meets ${minimum}:1 (--${fg} on --${bg})`, () => {
      const ratio = ratioOf(fg, bg);
      assert.ok(
        ratio >= minimum,
        `expected --${fg} (${tokens[fg]}) on --${bg} (${tokens[bg]}) to be at least ` +
          `${minimum}:1, but measured ${ratio.toFixed(2)}:1`,
      );
    });
  }
});
