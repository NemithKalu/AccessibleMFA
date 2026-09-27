// A very small attempt limiter, so a recovery code cannot be brute forced.
//
// In memory, so it resets when the server restarts. That is fine for a
// prototype; a real deployment would keep the counters in the database and
// count by IP as well as by account.

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

const failures = new Map(); // key -> { count, lockedUntil }

/** Milliseconds still locked out, or 0 if the caller may try. */
export function lockedFor(key) {
  const record = failures.get(key);
  if (!record || !record.lockedUntil) return 0;
  return Math.max(0, record.lockedUntil - Date.now());
}

export function recordFailure(key) {
  const record = failures.get(key) ?? { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_FAILURES) {
    record.lockedUntil = Date.now() + LOCK_MS;
    record.count = 0; // start the next window fresh once the lock expires
  }
  failures.set(key, record);
}

/** Called after a success, so a near-miss does not count against the user. */
export function clearFailures(key) {
  failures.delete(key);
}
