// Small shared helpers for user-supplied text.

/**
 * Trim a free-text label to something safe to store and display.
 * Templates escape on output, so this is about length and emptiness, not HTML.
 */
export function cleanLabel(raw, fallback) {
  const label = String(raw ?? '').trim().slice(0, 64);
  return label || fallback;
}
