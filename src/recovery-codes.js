// Recovery codes: the evidence a user presents when every passkey is gone.

import { createHash, randomInt } from 'node:crypto';

// No 0/O, 1/I/L. A recovery code often has to be read aloud, copied off a
// printout, or typed by someone who cannot see the screen, so characters that
// sound or look alike are simply not in the alphabet.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const CODE_LENGTH = 10; // 31^10 ≈ 2^49 possibilities per code
const GROUP = 5; // printed as XXXXX-XXXXX, easier to read back
export const CODE_COUNT = 10;

/**
 * Hash a code for storage. The plaintext is never written anywhere.
 *
 * A plain SHA-256 rather than argon2/bcrypt, and that is deliberate: those are
 * slow on purpose to make *guessing* expensive, which matters for a password a
 * human chose. A recovery code is 49 bits of randomness we generated, so there
 * is no dictionary to grind — an attacker with the database still has to try
 * about 2^48 codes. Passwords, when Phase 2 adds them, must still use argon2.
 */
export function hashCode(code) {
  return createHash('sha256').update(normalise(code)).digest('hex');
}

/**
 * Tidy what the user typed before comparing. Dashes, spaces and lower case are
 * all accepted, because insisting on exact punctuation punishes people typing
 * from a screen reader or a braille display for no security gain.
 */
export function normalise(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

/** A fresh set of plaintext codes. The caller shows them once, then forgets. */
export function generateCodes() {
  return Array.from({ length: CODE_COUNT }, generateCode);
}

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    if (i > 0 && i % GROUP === 0) code += '-';
    // randomInt is uniform: a naive "random byte % 31" would quietly favour
    // the first few letters of the alphabet.
    code += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return code;
}
