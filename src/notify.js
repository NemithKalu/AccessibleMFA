// Simulated out-of-band notifications.
//
// NOTHING IS ACTUALLY SENT. Real email, SMS and voice delivery are out of
// scope for the prototype, so every message is printed to the server console
// instead. Say so in the report and the viva: a console line is a placeholder
// for a channel, not a working security mechanism.

/**
 * Tell the user, on a channel the attacker is assumed not to control, that
 * something happened to their account. Never include a secret.
 */
export function notify({ to, channel, message }) {
  console.log(`\n[notify → ${channel}] to: ${to}\n  ${message}\n`);
}
