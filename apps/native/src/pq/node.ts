/** Native OpenSSL ML-DSA signing. The browser verifier uses a different implementation. */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  randomBytes,
} from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fromHex, hex, requireThat } from '../../../../packages/native/src/codec.ts';
import {
  canonical,
  keyId,
  policy,
  PROTOCOL,
  stateRoot,
  statementBytes,
  hash512,
  MAX_TTL_MS,
} from './checkpoint.ts';
import type { Policy, Snapshot, Statement, Attestation, TrustKey } from './checkpoint.ts';
const SPKI = Buffer.from('30820a32300b060960864801650304031303820a2100', 'hex');
export function rawPublic(key: KeyObject): string {
  const k = key.type === 'private' ? createPublicKey(key) : key;
  requireThat(k.asymmetricKeyType === 'ml-dsa-87', 'ML-DSA-87 key required');
  const der = k.export({ format: 'der', type: 'spki' });
  requireThat(
    der.length === SPKI.length + 2592 && der.subarray(0, SPKI.length).equals(SPKI),
    'noncanonical ML-DSA-87 SPKI',
  );
  return hex(der.subarray(SPKI.length));
}
export function signingKey(keyFile: string, passphraseFile: string): KeyObject {
  for (const file of [keyFile, passphraseFile]) {
    const st = statSync(file);
    requireThat(
      st.isFile() && (st.mode & 0o077) === 0,
      'signing secrets must have private permissions',
    );
  }
  const passphrase = readFileSync(passphraseFile);
  try {
    const key = createPrivateKey({ key: readFileSync(keyFile), format: 'pem', passphrase });
    rawPublic(key);
    return key;
  } finally {
    passphrase.fill(0);
  }
}
/** Development/admin provisioning only. Writes encrypted PKCS8, never logs a secret. */
export function createKeyFiles(
  directory: string,
  operator: string,
  now = Date.now(),
): { entry: TrustKey; keyFile: string; passphraseFile: string } {
  requireThat(/^[a-z0-9-]{1,32}$/.test(operator), 'operator');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const passphrase = randomBytes(32);
  const { privateKey, publicKey } = generateKeyPairSync('ml-dsa-87');
  const keyFile = resolve(directory, `${operator}.pem`),
    passphraseFile = resolve(directory, `${operator}.passphrase`);
  try {
    writeFileSync(
      keyFile,
      privateKey.export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase }),
      { mode: 0o600, flag: 'wx' },
    );
    writeFileSync(passphraseFile, passphrase, { mode: 0o600, flag: 'wx' });
  } finally {
    passphrase.fill(0);
  }
  const pk = rawPublic(publicKey);
  return {
    entry: {
      operator,
      keyId: keyId(pk),
      publicKey: pk,
      notBefore: now - 60000,
      notAfter: now + 30 * 86400000,
      revoked: false,
    },
    keyFile,
    passphraseFile,
  };
}
export function rulesHash(root = resolve('../..')): string {
  return hash512('Qlyphs/QPA1/rules-source', [
    readFileSync(resolve(root, 'packages/native/src/codec.ts'), 'utf8'),
    readFileSync(resolve(root, 'packages/native/src/protocol.ts'), 'utf8'),
  ]);
}
export function loadPolicy(file: string): Policy {
  const p = policy(JSON.parse(readFileSync(file, 'utf8')));
  requireThat(p.rulesHash === rulesHash(), 'policy differs from installed protocol');
  return p;
}
export function attest(
  snapshot: Snapshot,
  parentHash: string,
  challenge: string,
  p: Policy,
  operator: string,
  key: KeyObject,
  now = Date.now(),
): Attestation {
  policy(p, now);
  fromHex(challenge, 32);
  fromHex(parentHash, 32);
  const pk = rawPublic(key),
    k = p.keys.find((k) => k.operator === operator && k.publicKey === pk);
  requireThat(
    k && !k.revoked && k.notBefore <= now && k.notAfter > now + 1000,
    'signer not authorized',
  );
  const statement: Statement = {
    format: 1,
    protocol: PROTOCOL,
    policyVersion: p.version,
    genesis: p.genesis,
    activation: p.activation,
    runtimeHash: p.runtimeHash,
    rulesHash: p.rulesHash,
    height: snapshot.height,
    blockHash: snapshot.hash,
    parentHash,
    stateRoot: stateRoot(snapshot),
    challenge,
    issuedAt: now,
    expiresAt: Math.min(now + MAX_TTL_MS, k.notAfter, p.validUntil),
    operator,
    keyId: k.keyId,
  };
  return { statement, signature: hex(sign(null, statementBytes(statement), key)) };
}
export function sameScope(a: Policy, b: Policy): boolean {
  const scope = (p: Policy) => ({
    genesis: p.genesis,
    activation: p.activation,
    rulesHash: p.rulesHash,
    runtimeHash: p.runtimeHash,
  });
  return canonical(scope(a)) === canonical(scope(b));
}
