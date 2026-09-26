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
    backed_up        INTEGER NOT NULL,
    backup_eligible  INTEGER NOT NULL,
    created_at       TEXT NOT NULL,
    last_used_at     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);
`);

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
    backedUp: row.backed_up === 1,
    backupEligible: row.backup_eligible === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export default db;
