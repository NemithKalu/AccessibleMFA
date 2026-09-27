// Replacing every passkey on an account, for a user who has lost their device.
//
// The shape of the journey, and why:
//
//   1. The user proves something only they should have — a recovery code.
//   2. That buys a RESTRICTED session: they can look around, but they cannot
//      change anything about how the account is secured.
//   3. A request is opened with a waiting period. Nothing happens yet.
//   4. Every notification channel is told, so a thief cannot do this quietly.
//   5. Anyone who can sign in — including the real owner, from a device that
//      still works — can cancel it during the wait.
//   6. Only after the wait may a new passkey be registered, and doing so turns
//      off every old one.
//
// The waiting period is the point. A recovery code on its own is a single
// secret; the delay plus the notification is what stops a stolen one being
// spent silently.

import { RECOVERY_WAIT_MS } from './config.js';
import * as db from './db.js';
import { AuthError } from './errors.js';
import { notify } from './notify.js';

/** Open a request. The clock starts now; nothing is changed on the account. */
export function startRequest(user, evidence) {
  const activatesAt = new Date(Date.now() + RECOVERY_WAIT_MS).toISOString();
  const request = db.createRecoveryRequest({ userId: user.id, evidence, activatesAt });

  db.addAuditEntry({
    userId: user.id,
    event: 'recovery-started',
    detail: `A request to replace all passkeys was started using a ${describeEvidence(evidence)}. It can be completed after ${formatMoment(activatesAt)}.`,
  });

  // Out of band, so the real owner hears about it even if someone else is
  // holding the session. Phase 2 will send this to a verified email address
  // and trusted phone; for now the console stands in for both.
  notifyOwner(
    user,
    `Someone used a ${describeEvidence(evidence)} to start replacing the passkeys on your account. ` +
      `Nothing changes until ${formatMoment(activatesAt)}. ` +
      `If this was not you, sign in and cancel it, or contact support.`,
  );

  return request;
}

/** Cancel a running request. Safe to offer to any signed-in session. */
export function cancelRequest(user, request) {
  if (!db.settleRecoveryRequest(request.id, 'cancelled')) {
    throw new AuthError('That request had already finished, so there was nothing to cancel.');
  }

  db.addAuditEntry({
    userId: user.id,
    event: 'recovery-cancelled',
    detail: 'The request to replace all passkeys was cancelled. No devices were changed.',
  });
  notifyOwner(
    user,
    'The request to replace the passkeys on your account was cancelled. Your existing passkeys still work.',
  );
}

/**
 * Throw unless this user may register a replacement passkey right now.
 * Called from the registration route, which otherwise demands a full session.
 */
export function assertMayReplacePasskey(user) {
  const request = db.findPendingRecoveryRequest(user.id);
  if (!request) {
    throw new AuthError(
      'Adding a passkey needs a full sign-in with an existing passkey. If you have lost your devices, start a recovery instead.',
      403,
    );
  }
  if (!hasMatured(request)) {
    throw new AuthError(
      `The waiting period has not finished. You can add a new passkey after ${formatMoment(request.activates_at)}, which is ${describeRemaining(request.activates_at)} from now.`,
      403,
    );
  }
  return request;
}

/**
 * Finish the replacement: the new passkey stays, every other one is turned
 * off. Revoking rather than deleting means the lost device's sessions end on
 * their next request, and the account page can still show what happened.
 */
export function completeReplacement({ user, request, newCredentialId }) {
  const replaced = db
    .listActiveCredentials(user.id)
    .filter((credential) => credential.id !== newCredentialId);

  for (const credential of replaced) {
    db.revokeCredential({ id: credential.id, userId: user.id });
  }

  db.settleRecoveryRequest(request.id, 'completed');
  db.addAuditEntry({
    userId: user.id,
    event: 'recovery-completed',
    detail: `A replacement passkey was registered. ${replaced.length} older ${replaced.length === 1 ? 'passkey was' : 'passkeys were'} turned off.`,
  });
  notifyOwner(
    user,
    'A replacement passkey was registered on your account and your older passkeys were turned off.',
  );

  return replaced;
}

export function hasMatured(request) {
  return Date.parse(request.activates_at) <= Date.now();
}

/** "23 hours and 40 minutes" — in words, because a visual countdown is not
 *  readable by everyone and WCAG asks for timing that can be understood. */
export function describeRemaining(activatesAt) {
  const ms = Date.parse(activatesAt) - Date.now();
  if (ms <= 0) return 'no time at all';

  const minutes = Math.ceil(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return plural(minutes, 'minute');
  if (rest === 0) return plural(hours, 'hour');
  return `${plural(hours, 'hour')} and ${plural(rest, 'minute')}`;
}

export function formatMoment(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

export function describeEvidence(evidence) {
  return evidence === 'recovery-code' ? 'recovery code' : evidence;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function notifyOwner(user, message) {
  // Phase 2 (P4) adds a verified email address and trusted phone to the user
  // record. Until then there is nothing to address the message to but the
  // username, which is honest about what the prototype can actually do.
  notify({ to: user.username, channel: 'email', message });
  notify({ to: user.username, channel: 'trusted phone', message });
}
