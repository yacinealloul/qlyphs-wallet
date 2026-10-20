/** Solana vault authorizations: the 296-byte message a wallet signs so an ML-DSA-87 vault pays once. */

// Self-contained on purpose: wallets, sites and the on-chain verifier must read these bytes the same
// way. Development builds only for now: wallets list the methods only where they serve them.

/**
 * The FIPS 204 signing context of a vault authorization. Transactions and site sessions are signed
 * under other contexts, so no signature made here verifies as either of them, nor the reverse.
 */
export const SOLANA_VAULT_CONTEXT = 'qlyphs/solana-vault/v1';
export const SOLANA_VAULT_MESSAGE_BYTES = 296;
export const SOLANA_VAULT_PUBLIC_KEY_BYTES = 2592;
export const SOLANA_VAULT_SIGNATURE_BYTES = 4627;
/** The longest validity window a wallet signs, in Solana slots. */
export const MAX_SOLANA_VAULT_LIFETIME_SLOTS = 1500n;
/**
 * How far ahead of the wallet's view of the current slot an authorization may start, in slots
 * (about a minute): room for the site's and the wallet's RPC nodes to disagree, no more. The vault
 * program accepts an authorization once the slot reaches its issue slot, so without this bound a
 * site could have one signed now that only becomes spendable long after the person has forgotten it.
 */
export const SOLANA_VAULT_SLOT_TOLERANCE = 150n;
/** Roughly how long a Solana slot lasts, for showing a slot window as wall-clock time only. */
export const SOLANA_SLOT_MS = 400;
/** How long a wallet waits for the current slot before refusing, in milliseconds. */
export const SOLANA_SLOT_TIMEOUT_MS = 8000;
/** The wallet methods, served by development builds only. */
export const SOLANA_VAULT_METHODS = [
  'solanaVaultPublicKey',
  'signSolanaVaultAuthorization',
] as const;

const MAGIC = 'QLYP87V2';
/** SHA-256("Qlyphs ML-DSA-87 vault authorization v2"), compiled in like the verifier does. */
export const SOLANA_VAULT_DOMAIN =
  '0x7eb93662c2927e896d907b3170c082f03694112de6dd010142072d046ac99c11';
const VAULT_SEED = 'qp87v2';

/** A program deployment a wallet agrees to sign for: the cluster's genesis and the program id. */
export interface SolanaVaultDeployment {
  readonly name: string;
  readonly genesis: string;
  readonly program: string;
  /**
   * Only on a deployment that redeems a wrapped token (wQTC): its mint. Action 2 is accepted for
   * this mint alone; a deployment without one refuses action 2.
   */
  readonly redeemMint?: string;
}
/** Decimals of a redeemable wrapped token: one wQTC is one QTC, counted in nano units. */
export const SOLANA_VAULT_REDEEM_DECIMALS = 9;
/**
 * The vault program on Solana devnet. Anything not in a wallet's allowlist is refused before any
 * review; a wallet may add deployments of its own (`parseSolanaVaultAuthorization`).
 */
export const SOLANA_VAULT_DEPLOYMENTS: readonly SolanaVaultDeployment[] = Object.freeze([
  Object.freeze({
    name: 'Solana devnet',
    genesis: '0xce59db5080fc2c6d3bcf7ca90712d3c2e5e6c28f27f0dfbb9953bdb0894c03ab',
    program: '0x3f9a7e996f7c4e40fdf6014cb177a7cfa462b1ca9b67f41b0a91b069cf76a4e5',
  }),
]);
/**
 * Where a wallet reads the current slot of a cluster, keyed by the cluster's genesis hash (the one
 * an authorization names, so the slot is always its own cluster's). A cluster without one is refused.
 */
export const SOLANA_VAULT_RPC: Readonly<Record<string, string>> = Object.freeze({
  [SOLANA_VAULT_DEPLOYMENTS[0]!.genesis]: 'https://api.devnet.solana.com',
});

/**
 * A decoded authorization. 32-byte fields are 0x + 64 lowercase hex; u64 fields are bigint.
 *
 * Layout, little-endian, 296 bytes:
 *
 * | offset | size | field                                          |
 * | -----: | ---: | ---------------------------------------------- |
 * |      0 |    8 | ASCII `QLYP87V2`                               |
 * |      8 |   32 | domain, `SOLANA_VAULT_DOMAIN`                  |
 * |     40 |   32 | program id                                     |
 * |     72 |   32 | vault address (program derived)               |
 * |    104 |    8 | vault nonce                                    |
 * |    112 |    8 | expiry slot, exclusive                         |
 * |    120 |    1 | action: 0 SOL, 1 SPL token, 2 redeem           |
 * |    121 |    1 | token decimals, 0 for SOL, 9 for a redeem      |
 * |    122 |    6 | zero                                           |
 * |    128 |   32 | token mint, zero for SOL                       |
 * |    160 |   32 | source token account, zero for SOL             |
 * |    192 |   32 | destination: Solana account, or for a redeem   |
 * |        |      | the Quantus account id that receives QTC       |
 * |    224 |    8 | amount in base units, above zero               |
 * |    232 |   24 | zero                                           |
 * |    256 |   32 | cluster genesis hash                           |
 * |    288 |    8 | issue slot, below expiry by at most 1,500 slots |
 */
export interface SolanaVaultAuthorization {
  readonly deployment: SolanaVaultDeployment;
  /** `payment` moves SOL or a token on Solana; `redeem` burns the wrapped token for its QTC. */
  readonly kind: 'payment' | 'redeem';
  readonly vault: string;
  readonly nonce: bigint;
  readonly expiry: bigint;
  readonly issuedAt: bigint;
  readonly asset: 'SOL' | 'SPL';
  readonly decimals: number;
  readonly mint: string | null;
  readonly source: string | null;
  readonly destination: string;
  readonly amount: bigint;
}

/** What `solanaVaultPublicKey` returns: the active account and its key, hex. */
export interface SolanaVaultKey {
  /** The wallet account's address, as the wallet shows it. */
  readonly address: string;
  readonly publicKey: string;
  /** The account's vault on the allowlisted deployment, base58. */
  readonly vault: string;
}
/** What `signSolanaVaultAuthorization` returns. */
export interface SolanaVaultSignature {
  readonly publicKey: string;
  readonly signature: string;
}

export class SolanaVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SolanaVaultError';
  }
}
function need(ok: unknown, message: string): asserts ok {
  if (!ok) throw new SolanaVaultError(message);
}

const toHex = (bytes: Uint8Array): string =>
  '0x' + Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
/** Only the one canonical spelling: 0x then lowercase hex of exactly `length` bytes. */
export function solanaVaultBytes(value: unknown, length: number): Uint8Array {
  need(
    typeof value === 'string' &&
      value.length === 2 + 2 * length &&
      /^0x[0-9a-f]*$/.test(value),
    'expected 0x and lowercase hex of the exact length',
  );
  return Uint8Array.from((value as string).slice(2).match(/../g) ?? [], (x) => parseInt(x, 16));
}
const zero = (bytes: Uint8Array) => bytes.every((x) => x === 0);

/**
 * Decodes and checks an authorization without any key: format, domain, allowlisted deployment,
 * action fields, padding, amount and lifetime. The wallet still checks that the vault is its own.
 * `deployments` is the allowlist: by default the vault program alone.
 */
export function parseSolanaVaultAuthorization(
  message: unknown,
  deployments: readonly SolanaVaultDeployment[] = SOLANA_VAULT_DEPLOYMENTS,
): SolanaVaultAuthorization {
  const m = solanaVaultBytes(message, SOLANA_VAULT_MESSAGE_BYTES);
  const view = new DataView(m.buffer, m.byteOffset, m.byteLength);
  const field = (at: number) => toHex(m.subarray(at, at + 32));
  need(new TextDecoder().decode(m.subarray(0, 8)) === MAGIC, 'unknown message format');
  need(field(8) === SOLANA_VAULT_DOMAIN, 'unknown message domain');
  const program = field(40),
    genesis = field(256);
  need(
    deployments.some((d) => d.genesis === genesis),
    'unknown network',
  );
  const deployment = deployments.find((d) => d.genesis === genesis && d.program === program);
  need(deployment, 'unknown program');
  const action = m[120]!,
    decimals = m[121]!;
  need(action === 0 || action === 1 || action === 2, 'unknown action');
  need(action !== 2 || deployment.redeemMint !== undefined, 'this program does not redeem');
  need(zero(m.subarray(122, 128)) && zero(m.subarray(232, 256)), 'nonzero padding');
  const mint = m.subarray(128, 160),
    source = m.subarray(160, 192),
    destination = m.subarray(192, 224);
  if (action === 0)
    need(decimals === 0 && zero(mint) && zero(source), 'SOL payments carry no token fields');
  else need(!zero(mint) && !zero(source), 'token payments name their mint and source');
  if (action === 2)
    need(
      decimals === SOLANA_VAULT_REDEEM_DECIMALS && toHex(mint) === deployment.redeemMint,
      'a redeem burns the deployment\'s own token',
    );
  need(!zero(destination), 'missing destination');
  const amount = view.getBigUint64(224, true),
    nonce = view.getBigUint64(104, true),
    expiry = view.getBigUint64(112, true),
    issuedAt = view.getBigUint64(288, true);
  need(amount > 0n, 'zero amount');
  need(
    issuedAt < expiry && expiry - issuedAt <= MAX_SOLANA_VAULT_LIFETIME_SLOTS,
    'invalid lifetime',
  );
  return Object.freeze({
    deployment,
    kind: action === 2 ? 'redeem' : 'payment',
    vault: field(72),
    nonce,
    expiry,
    issuedAt,
    asset: action === 0 ? 'SOL' : 'SPL',
    decimals,
    mint: action === 0 ? null : toHex(mint),
    source: action === 0 ? null : toHex(source),
    destination: toHex(destination),
    amount,
  });
}

/**
 * Checks an authorization's slot window against the current slot of its cluster, which the wallet
 * reads itself (`solanaCurrentSlot`), never from the site: it must not start more than
 * `SOLANA_VAULT_SLOT_TOLERANCE` slots ahead, must not already have expired, and must not end more
 * than the longest lifetime plus that tolerance ahead. `parseSolanaVaultAuthorization` bounds only
 * the window's length; this bounds where it sits.
 */
export function checkSolanaVaultWindow(
  a: Pick<SolanaVaultAuthorization, 'issuedAt' | 'expiry'>,
  currentSlot: bigint,
): void {
  need(typeof currentSlot === 'bigint' && currentSlot >= 0n, 'unknown current slot');
  need(a.issuedAt <= currentSlot + SOLANA_VAULT_SLOT_TOLERANCE, 'authorization starts in the future');
  need(a.expiry > currentSlot, 'authorization expired');
  need(
    a.expiry <= currentSlot + MAX_SOLANA_VAULT_LIFETIME_SLOTS + SOLANA_VAULT_SLOT_TOLERANCE,
    'authorization ends too far in the future',
  );
}

/**
 * The current slot of a deployment's cluster, from the wallet's own endpoint for it
 * (`SOLANA_VAULT_RPC`, `getSlot` at confirmed commitment), within `SOLANA_SLOT_TIMEOUT_MS`. No
 * endpoint, a late answer or a malformed one is refused.
 */
export async function solanaCurrentSlot(
  deployment: Pick<SolanaVaultDeployment, 'genesis'>,
  fetcher: typeof fetch = fetch,
  timeoutMs = SOLANA_SLOT_TIMEOUT_MS,
): Promise<bigint> {
  need(Object.hasOwn(SOLANA_VAULT_RPC, deployment.genesis), 'no endpoint for this cluster');
  // The signal also bounds reading the body: a node that sends headers and then stalls is cut off.
  const response = await fetcher(SOLANA_VAULT_RPC[deployment.genesis]!, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getSlot',
      params: [{ commitment: 'confirmed' }],
    }),
  });
  need(response.ok, 'slot request failed');
  const body = (await response.json()) as { result?: unknown };
  need(
    body !== null && typeof body === 'object' && Number.isSafeInteger(body.result) && (body.result as number) >= 0,
    'invalid slot',
  );
  return BigInt(body.result as number);
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Base58 (Bitcoin alphabet), the way Solana writes addresses. */
export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return '1'.repeat(zeros) + out;
}

const P = 2n ** 255n - 19n;
const mod = (a: bigint) => ((a % P) + P) % P;
function power(base: bigint, exponent: bigint): bigint {
  let result = 1n,
    b = mod(base),
    e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}
const D = mod(-121665n * power(121666n, P - 2n));
/**
 * Whether 32 bytes decompress to an ed25519 point: Solana's test for a program derived address,
 * which must not be one. Public data only, so this need not run in constant time.
 */
export function onCurve(encoded: Uint8Array): boolean {
  need(encoded.length === 32, 'expected 32 bytes');
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(encoded[i]!);
  y = mod(y & ((1n << 255n) - 1n));
  const u = mod(y * y - 1n),
    v = mod(D * y * y + 1n);
  if (v === 0n) return false;
  const x2 = mod(u * power(v, P - 2n));
  return x2 === 0n || power(x2, (P - 1n) / 2n) === 1n;
}

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    data.set(p, at);
    at += p.length;
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}
/** Solana's find_program_address: the first bump from 255 down whose hash is off the curve. */
export async function findProgramAddress(
  seeds: readonly Uint8Array[],
  program: Uint8Array,
): Promise<{ address: Uint8Array; bump: number }> {
  need(program.length === 32, 'expected a 32-byte program id');
  need(seeds.length <= 15 && seeds.every((s) => s.length <= 32), 'invalid seeds');
  const marker = new TextEncoder().encode('ProgramDerivedAddress');
  for (let bump = 255; bump >= 0; bump--) {
    const address = await sha256(...seeds, Uint8Array.of(bump), program, marker);
    if (!onCurve(address)) return { address, bump };
  }
  throw new SolanaVaultError('no program address');
}
/** The vault of an ML-DSA-87 public key: PDA("qp87v2", genesis, SHA-256(public key)). 0x hex. */
export async function solanaVaultAddress(
  publicKey: Uint8Array,
  deployment: SolanaVaultDeployment = SOLANA_VAULT_DEPLOYMENTS[0]!,
): Promise<string> {
  need(publicKey.length === SOLANA_VAULT_PUBLIC_KEY_BYTES, 'ML-DSA-87 public key required');
  const { address } = await findProgramAddress(
    [
      new TextEncoder().encode(VAULT_SEED),
      solanaVaultBytes(deployment.genesis, 32),
      await sha256(publicKey),
    ],
    solanaVaultBytes(deployment.program, 32),
  );
  return toHex(address);
}

function exactKeys(value: unknown, names: readonly string[]): Record<string, unknown> {
  need(value !== null && typeof value === 'object' && !Array.isArray(value), 'object expected');
  const o = value as Record<string, unknown>;
  need(
    Object.keys(o).length === names.length && names.every((k) => Object.hasOwn(o, k)),
    'unexpected fields',
  );
  return o;
}
/** Checks a `solanaVaultPublicKey` result: exact fields, key size, base58 vault. */
export function parseSolanaVaultKey(value: unknown): SolanaVaultKey {
  const o = exactKeys(value, ['address', 'publicKey', 'vault']);
  need(typeof o.address === 'string' && /^[1-9A-HJ-NP-Za-km-z]{1,64}$/.test(o.address), 'invalid address');
  solanaVaultBytes(o.publicKey, SOLANA_VAULT_PUBLIC_KEY_BYTES);
  need(typeof o.vault === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(o.vault), 'invalid vault');
  return Object.freeze({
    address: o.address as string,
    publicKey: o.publicKey as string,
    vault: o.vault as string,
  });
}
/** Checks a `signSolanaVaultAuthorization` result: exact fields and sizes. */
export function parseSolanaVaultSignature(value: unknown): SolanaVaultSignature {
  const o = exactKeys(value, ['publicKey', 'signature']);
  solanaVaultBytes(o.publicKey, SOLANA_VAULT_PUBLIC_KEY_BYTES);
  solanaVaultBytes(o.signature, SOLANA_VAULT_SIGNATURE_BYTES);
  return Object.freeze({ publicKey: o.publicKey as string, signature: o.signature as string });
}
