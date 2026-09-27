// SQLite access. One file, no migration tooling: the schema is created on boot
// with CREATE TABLE IF NOT EXISTS so a clean clone just works.

import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
// Overridable so the tests can run against a throwaway database.
const dbPath = process.env.AMFA_DB_PATH ?? join(projectRoot, 'data', 'app.db');

mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY,
    username     TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    -- Random per-user handle, sent to the authenticator as WebAuthn's user.id.
    -- Deliberately NOT the username or the row id: the spec says user.id must
    -- not contain personal data, and usernameless sign-in works by the
    -- authenticator handing this value back for us to look the account up by.
    user_handle  TEXT NOT NULL UNIQUE,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS credentials (
    -- The credential ID, base64url encoded, exactly as the browser reports it.
    id               TEXT PRIMARY KEY,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Only the PUBLIC key is ever stored. The private key never leaves the
    -- authenticator; the server cannot sign anything on the user's behalf.
    public_key       BLOB NOT NULL,
    counter          INTEGER NOT NULL,
    transports       TEXT NOT NULL,
    device_name      TEXT NOT NULL,
    -- 'active' or 'revoked'. Revoked rows are kept, not deleted, so the
    -- device list can still show that a lost device was turned off and when.
    status           TEXT NOT NULL DEFAULT 'active',
    backed_up        INTEGER NOT NULL,
    backup_eligible  INTEGER NOT NULL,
    created_at       TEXT NOT NULL,
    last_used_at     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);

  -- One row per recovery code. Only the hash is stored, and used_at is what
  -- makes a code single use: once it is set, the code can never match again.
  CREATE TABLE IF NOT EXISTS recovery_codes (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used_at    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes(user_id);

  -- A plain record of security-relevant events, shown to the user on /activity.
  -- Never holds a secret: the event says a recovery code was used, not which.
  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    event      TEXT NOT NULL,
    detail     TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

/**
 * Add a column to an existing database. CREATE TABLE IF NOT EXISTS does
 * nothing to a table that is already there, so a teammate who ran an earlier
 * version would otherwise have to delete their database file.
 */
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing('credentials', 'status', "TEXT NOT NULL DEFAULT 'active'");

const now = () => new Date().toISOString();

/** 16 random bytes, base64url encoded — the value stored in users.user_handle. */
export function generateUserHandle() {
  return randomBytes(16).toString('base64url');
}

export function createUser({ username, displayName, userHandle }) {
  const info = db
    .prepare(
      `INSERT INTO users (username, display_name, user_handle, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(username, displayName, userHandle, now());
  return findUserById(info.lastInsertRowid);
}

export function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function findUserByHandle(userHandle) {
  return db.prepare('SELECT * FROM users WHERE user_handle = ?').get(userHandle);
}

export function listCredentials(userId) {
  return db
    .prepare('SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at')
    .all(userId)
    .map(toCredential);
}

/** Only the passkeys that can still be used to sign in. */
export function listActiveCredentials(userId) {
  return listCredentials(userId).filter((credential) => credential.status === 'active');
}

export function findCredentialById(id) {
  const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id);
  return row ? toCredential(row) : undefined;
}

export function addCredential(credential) {
  db.prepare(
    `INSERT INTO credentials
       (id, user_id, public_key, counter, transports, device_name,
        backed_up, backup_eligible, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    credential.id,
    credential.userId,
    Buffer.from(credential.publicKey),
    credential.counter,
    JSON.stringify(credential.transports ?? []),
    credential.deviceName,
    credential.backedUp ? 1 : 0,
    credential.backupEligible ? 1 : 0,
    now(),
  );
}

/** Called after every successful assertion, to keep the replay defence current. */
export function recordCredentialUse({ id, counter, backedUp }) {
  db.prepare(
    'UPDATE credentials SET counter = ?, backed_up = ?, last_used_at = ? WHERE id = ?',
  ).run(counter, backedUp ? 1 : 0, now(), id);
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

/**
 * Replace the whole set. Generating a new set always invalidates the old one,
 * so a code written down last year cannot be used after a re-generation.
 * One transaction, so a half-replaced set can never be left behind.
 */
export const replaceRecoveryCodes = db.transaction((userId, codeHashes) => {
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
  const insert = db.prepare(
    'INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)',
  );
  for (const hash of codeHashes) insert.run(userId, hash, now());
});

export function countUnusedRecoveryCodes(userId) {
  return db
    .prepare(
      'SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL',
    )
    .get(userId).n;
}

/** Find an unused code by its hash. Returns undefined if used or unknown. */
export function findUnusedRecoveryCode(userId, codeHash) {
  return db
    .prepare(
      `SELECT * FROM recovery_codes
       WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
    )
    .get(userId, codeHash);
}

/**
 * Burn a code. The WHERE clause repeats "used_at IS NULL" so that two requests
 * racing with the same code can only ever spend it once — the second UPDATE
 * matches no rows.
 */
export function useRecoveryCode(id) {
  const info = db
    .prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .run(now(), id);
  return info.changes === 1;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export function addAuditEntry({ userId, event, detail }) {
  db.prepare(
    'INSERT INTO audit_log (user_id, event, detail, created_at) VALUES (?, ?, ?, ?)',
  ).run(userId, event, detail, now());
}

export function listAuditEntries(userId) {
  return db
    .prepare('SELECT * FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(userId);
}

/** Both take user_id in the WHERE clause so one user cannot touch another's
 *  device by guessing a credential ID. */
export function renameCredential({ id, userId, deviceName }) {
  const info = db
    .prepare('UPDATE credentials SET device_name = ? WHERE id = ? AND user_id = ?')
    .run(deviceName, id, userId);
  return info.changes === 1;
}

export function revokeCredential({ id, userId }) {
  const info = db
    .prepare(
      `UPDATE credentials SET status = 'revoked'
       WHERE id = ? AND user_id = ? AND status = 'active'`,
    )
    .run(id, userId);
  return info.changes === 1;
}

function toCredential(row) {
  return {
    id: row.id,
    userId: row.user_id,
    // Stored as a BLOB; hand it back as a Uint8Array, which is what
    // @simplewebauthn/server expects on a WebAuthnCredential.
    publicKey: new Uint8Array(row.public_key),
    counter: row.counter,
    transports: JSON.parse(row.transports),
    deviceName: row.device_name,
    status: row.status,
    backedUp: row.backed_up === 1,
    backupEligible: row.backup_eligible === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export default db;
