/**
 * A software authenticator, for tests only.
 *
 * It does in Node what a security key or a phone's secure element does in
 * real life: holds a private key, and signs a challenge once it believes the
 * user has been verified. It exists so the tests can prove the *server's*
 * checks — user verification, single-use challenges, the signature counter —
 * without a browser or a fingerprint reader.
 *
 * Unlike a real authenticator it will happily lie on request (skip user
 * verification, replay an old counter), which is exactly what makes it useful.
 */

import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';
import { encode } from './cbor.js';

// Authenticator data flag bits, from the WebAuthn specification.
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_BACKUP_ELIGIBLE = 0x08;
const FLAG_BACKED_UP = 0x10;
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;

const sha256 = (data) => createHash('sha256').update(data).digest();
const b64url = (buffer) => Buffer.from(buffer).toString('base64url');

export class SoftwareAuthenticator {
  constructor({ backupEligible = false, backedUp = false } = {}) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.credentialId = randomBytes(32);
    this.aaguid = Buffer.alloc(16); // all-zero, as "none" attestation expects
    this.counter = 0;
    this.backupEligible = backupEligible;
    this.backedUp = backedUp;
  }

  get credentialIdB64() {
    return b64url(this.credentialId);
  }

  /** The public key in COSE_Key form: what the server will store. */
  cosePublicKey() {
    const jwk = this.publicKey.export({ format: 'jwk' });
    return encode(
      new Map([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x, 'base64url')],
        [-3, Buffer.from(jwk.y, 'base64url')],
      ]),
    );
  }

  // `userPresent` defaults to true (a real authenticator always sets it) and
  // exists only so a test can clear it — producing the invalid "verified but
  // not present" combination needed to exercise the server's not-present
  // check on purpose, without weakening what a real authenticator can send.
  flags({ userVerified, userPresent = true, attested }) {
    let flags = 0;
    if (userPresent) flags |= FLAG_USER_PRESENT;
    if (userVerified) flags |= FLAG_USER_VERIFIED;
    if (this.backupEligible) flags |= FLAG_BACKUP_ELIGIBLE;
    if (this.backedUp) flags |= FLAG_BACKED_UP;
    if (attested) flags |= FLAG_ATTESTED_CREDENTIAL_DATA;
    return flags;
  }

  authenticatorData({ rpId, userVerified, userPresent, attested, counter }) {
    const header = Buffer.alloc(37);
    sha256(rpId).copy(header, 0);
    header[32] = this.flags({ userVerified, userPresent, attested });
    header.writeUInt32BE(counter, 33);

    if (!attested) return header;

    const credentialIdLength = Buffer.alloc(2);
    credentialIdLength.writeUInt16BE(this.credentialId.length, 0);
    return Buffer.concat([
      header,
      this.aaguid,
      credentialIdLength,
      this.credentialId,
      this.cosePublicKey(),
    ]);
  }

  clientData(type, challenge, origin) {
    return Buffer.from(
      JSON.stringify({ type, challenge, origin, crossOrigin: false }),
      'utf8',
    );
  }

  /** Respond to navigator.credentials.create(). */
  register({ rpId, origin, challenge, userVerified = true }) {
    const clientDataJSON = this.clientData('webauthn.create', challenge, origin);
    const authData = this.authenticatorData({
      rpId,
      userVerified,
      attested: true,
      counter: this.counter,
    });

    const attestationObject = encode(
      new Map([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );

    return {
      id: this.credentialIdB64,
      rawId: this.credentialIdB64,
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      type: 'public-key',
      authenticatorAttachment: 'platform',
    };
  }

  /**
   * Respond to navigator.credentials.get().
   *
   * `counter` overrides the reported signature count, so a test can simulate
   * a cloned authenticator replaying an old one.
   */
  authenticate({
    rpId,
    origin,
    challenge,
    userHandle,
    userVerified = true,
    userPresent = true, // opt out to simulate no touch/button press (the not-present failure)
    counter,
  }) {
    const reportedCounter = counter ?? ++this.counter;
    const clientDataJSON = this.clientData('webauthn.get', challenge, origin);
    const authData = this.authenticatorData({
      rpId,
      userVerified,
      userPresent,
      attested: false,
      counter: reportedCounter,
    });

    // The signature covers the authenticator data and a hash of the client
    // data, which is what binds the assertion to this challenge and origin.
    const signature = createSign('SHA256')
      .update(Buffer.concat([authData, sha256(clientDataJSON)]))
      .sign(this.privateKey);

    return {
      id: this.credentialIdB64,
      rawId: this.credentialIdB64,
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        ...(userHandle ? { userHandle } : {}),
      },
      clientExtensionResults: {},
      type: 'public-key',
      authenticatorAttachment: 'platform',
    };
  }
}
