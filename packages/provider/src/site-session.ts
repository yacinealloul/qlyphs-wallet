/** Site session challenges: the one fixed byte format a wallet signs to prove account control. */

// Self-contained on purpose: wallets, sites and services must all read these bytes the same way.

/**
 * The FIPS 204 signing context of a site session signature. Transactions are signed under
 * `QUANTUS_EXTRINSIC`, so no signature made here can ever verify as a transaction, nor the reverse.
 */
export const SITE_SESSION_CONTEXT = 'QLYPHS_SITE_SESSION_V1';
/** The longest session a wallet signs, counted from its own clock. */
export const MAX_SITE_SESSION_MS = 15 * 60_000;
export const SITE_SESSION_MAGIC = 'QLYPHS';
export const SITE_SESSION_VERSION = 1;
export const SITE_SESSION_PURPOSE = 'site-session';
/** ML-DSA-87 sizes, in bytes. */
export const SITE_SESSION_SIGNATURE_BYTES = 4627;
export const SITE_SESSION_PUBLIC_KEY_BYTES = 2592;
const MAX_ACTIONS = 8;
/** Larger than any valid challenge (about 750 bytes), so a parser can refuse early. */
export const MAX_SITE_SESSION_CHALLENGE_BYTES = 1024;

/**
 * A decoded challenge. Account ids and the nonce are 0x + 64 lowercase hex.
 *
 * Encoding, version 1, with no padding and no trailing bytes (u8 is one byte, u64 is eight bytes
 * little-endian, `text` is a u8 length then that many ASCII bytes):
 *
 * | field       | encoding                                                            |
 * | ----------- | ------------------------------------------------------------------- |
 * | magic       | 6 bytes, ASCII `QLYPHS`                                             |
 * | version     | u8, `1`                                                             |
 * | purpose     | text, `site-session`                                                |
 * | genesis     | 32 bytes: the network's genesis hash                                |
 * | service     | 32 bytes: the account id of the service the session is for          |
 * | account     | 32 bytes: the account id that signs                                 |
 * | audience    | text, 1 to 64 of `a-z 0-9 . -`: the service's name for itself        |
 * | origin      | text, an exact web origin: https, or http on a loopback host        |
 * | nonce       | 32 bytes, random, chosen by the service                             |
 * | issuedAt    | u64, Unix milliseconds                                              |
 * | expiresAt   | u64, Unix milliseconds, at most 15 minutes after issuedAt           |
 * | actions     | u8 count (1 to 8), then each as text of `a-z 0-9 -` (1 to 32),      |
 * |             | starting with a letter, in strictly increasing byte order            |
 *
 * The parser accepts only bytes that re-encode to themselves, so one challenge has one encoding.
 */
export interface SiteSessionChallenge {
  readonly genesis: string;
  readonly service: string;
  readonly account: string;
  readonly audience: string;
  readonly origin: string;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly actions: readonly string[];
}

/** What a wallet returns: hex of the ML-DSA-87 signature and of the signing public key. */
export interface SiteSessionProof {
  readonly signature: string;
  readonly publicKey: string;
}

export class SiteSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteSessionError';
  }
}
function need(ok: unknown, message: string): asserts ok {
  if (!ok) throw new SiteSessionError(message);
}

const ID = /^0x[0-9a-f]{64}$/;
const AUDIENCE = /^[a-z0-9.-]{1,64}$/;
const ACTION = /^[a-z][a-z0-9-]{0,31}$/;
const ZERO = '0x' + '00'.repeat(32);

/** An exact origin, as `URL.origin` writes it: https, or http on a loopback host. */
export function siteOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 255 || !/^[\x21-\x7e]+$/.test(value)) return false;
  try {
    const u = new URL(value);
    return (
      u.origin === value &&
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
    );
  } catch {
    return false;
  }
}

function checkFields(c: SiteSessionChallenge): void {
  need(c && typeof c === 'object', 'challenge expected');
  for (const id of [c.genesis, c.service, c.account, c.nonce])
    need(typeof id === 'string' && ID.test(id), 'invalid 32-byte field');
  need(c.service !== ZERO && c.account !== ZERO && c.service !== c.account, 'invalid accounts');
  need(typeof c.audience === 'string' && AUDIENCE.test(c.audience), 'invalid audience');
  need(siteOrigin(c.origin), 'invalid origin');
  for (const t of [c.issuedAt, c.expiresAt])
    need(Number.isSafeInteger(t) && t > 0, 'invalid time');
  need(
    c.issuedAt < c.expiresAt && c.expiresAt - c.issuedAt <= MAX_SITE_SESSION_MS,
    'invalid session lifetime',
  );
  need(
    Array.isArray(c.actions) && c.actions.length >= 1 && c.actions.length <= MAX_ACTIONS,
    'invalid actions',
  );
  c.actions.forEach((a, i) => {
    need(typeof a === 'string' && ACTION.test(a), 'invalid action');
    // ASCII only, so string order is byte order.
    need(i === 0 || c.actions[i - 1]! < a, 'actions must be sorted and unique');
  });
}

const ascii = (s: string): number[] => [...s].map((ch) => ch.charCodeAt(0));
const idBytes = (id: string): number[] => {
  const out: number[] = [];
  for (let i = 2; i < id.length; i += 2) out.push(parseInt(id.slice(i, i + 2), 16));
  return out;
};
const u64 = (n: number): number[] => {
  const out: number[] = [];
  let v = BigInt(n);
  for (let i = 0; i < 8; i++) {
    out.push(Number(v & 0xffn));
    v >>= 8n;
  }
  return out;
};
const text = (s: string): number[] => [s.length, ...ascii(s)];

/** The canonical bytes of a challenge; throws on any field outside the format. */
export function encodeSiteSessionChallenge(c: SiteSessionChallenge): Uint8Array {
  checkFields(c);
  return Uint8Array.from([
    ...ascii(SITE_SESSION_MAGIC),
    SITE_SESSION_VERSION,
    ...text(SITE_SESSION_PURPOSE),
    ...idBytes(c.genesis),
    ...idBytes(c.service),
    ...idBytes(c.account),
    ...text(c.audience),
    ...text(c.origin),
    ...idBytes(c.nonce),
    ...u64(c.issuedAt),
    ...u64(c.expiresAt),
    c.actions.length,
    ...c.actions.flatMap(text),
  ]);
}

const HEX = /^0x(?:[0-9a-f]{2})+$/;
const toHex = (bytes: Uint8Array): string =>
  '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
function fromHexString(value: unknown, max: number): Uint8Array {
  need(typeof value === 'string' && value.length <= 2 + 2 * max && HEX.test(value), 'hex expected');
  return Uint8Array.from(idBytes(value));
}

/** Decodes canonical challenge bytes (or their 0x hex) and checks every field. */
export function parseSiteSessionChallenge(input: Uint8Array | string): SiteSessionChallenge {
  const bytes =
    typeof input === 'string' ? fromHexString(input, MAX_SITE_SESSION_CHALLENGE_BYTES) : input;
  need(bytes instanceof Uint8Array && bytes.length <= MAX_SITE_SESSION_CHALLENGE_BYTES, 'too large');
  let at = 0;
  const take = (n: number): Uint8Array => {
    need(at + n <= bytes.length, 'truncated challenge');
    const out = bytes.subarray(at, at + n);
    at += n;
    return out;
  };
  const byte = (): number => take(1)[0]!;
  const str = (): string => String.fromCharCode(...take(byte()));
  const id = (): string => toHex(take(32));
  const time = (): number => {
    const b = take(8);
    let v = 0n;
    for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[i]!);
    need(v <= BigInt(Number.MAX_SAFE_INTEGER), 'invalid time');
    return Number(v);
  };
  need(String.fromCharCode(...take(6)) === SITE_SESSION_MAGIC, 'not a site session challenge');
  need(byte() === SITE_SESSION_VERSION, 'unsupported challenge version');
  need(str() === SITE_SESSION_PURPOSE, 'unsupported challenge purpose');
  const genesis = id(),
    service = id(),
    account = id(),
    audience = str(),
    origin = str(),
    nonce = id(),
    issuedAt = time(),
    expiresAt = time(),
    count = byte();
  need(count >= 1 && count <= MAX_ACTIONS, 'invalid actions');
  const actions: string[] = [];
  for (let i = 0; i < count; i++) actions.push(str());
  need(at === bytes.length, 'trailing bytes');
  const challenge: SiteSessionChallenge = Object.freeze({
    genesis,
    service,
    account,
    audience,
    origin,
    nonce,
    issuedAt,
    expiresAt,
    actions: Object.freeze(actions),
  });
  // Re-encoding refuses everything the field checks refuse, and any second spelling of the bytes.
  const again = encodeSiteSessionChallenge(challenge);
  need(again.length === bytes.length && again.every((b, i) => b === bytes[i]), 'not canonical');
  return challenge;
}

/** Checks the shape of a wallet's answer: exact keys and ML-DSA-87 sizes. */
export function parseSiteSessionProof(value: unknown): SiteSessionProof {
  need(value !== null && typeof value === 'object' && !Array.isArray(value), 'proof expected');
  const o = value as Record<string, unknown>;
  need(
    Object.keys(o).length === 2 && Object.hasOwn(o, 'signature') && Object.hasOwn(o, 'publicKey'),
    'unexpected proof fields',
  );
  need(
    fromHexString(o.signature, SITE_SESSION_SIGNATURE_BYTES).length === SITE_SESSION_SIGNATURE_BYTES,
    'invalid signature size',
  );
  need(
    fromHexString(o.publicKey, SITE_SESSION_PUBLIC_KEY_BYTES).length === SITE_SESSION_PUBLIC_KEY_BYTES,
    'invalid public key size',
  );
  return Object.freeze({ signature: o.signature as string, publicKey: o.publicKey as string });
}
