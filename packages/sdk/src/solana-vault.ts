/** Solana vault requests: the connected account's ML-DSA-87 key, and signed vault authorizations. */
import {
  QlyphsError,
  base58,
  parseSolanaVaultAuthorization,
  parseSolanaVaultKey,
  parseSolanaVaultSignature,
  publicError,
  solanaVaultAddress,
  solanaVaultBytes,
  SOLANA_VAULT_MESSAGE_BYTES,
  SOLANA_VAULT_PUBLIC_KEY_BYTES,
  validTimeout,
} from '../../provider/src/index.ts';
import type {
  QlyphsProvider,
  RequestOptions,
  SolanaVaultAuthorization,
  SolanaVaultDeployment,
  SolanaVaultKey,
  SolanaVaultSignature,
} from '../../provider/src/index.ts';

// Development wallet builds only: other builds do not list these methods in `capabilities`, and
// these helpers then fail with UNSUPPORTED_METHOD before asking anything.

type Method = 'solanaVaultPublicKey' | 'signSolanaVaultAuthorization';

/** One request, after a capability read that lists `method`; the read spends part of the budget. */
async function ask(
  provider: QlyphsProvider,
  method: Method,
  params: { message: string } | undefined,
  options: RequestOptions,
): Promise<unknown> {
  const total = validTimeout(options.timeoutMs, 135_000);
  const started = Date.now();
  if (provider?.protocolVersion !== 2 || typeof provider.request !== 'function')
    throw new QlyphsError('UNSUPPORTED_METHOD', 'This wallet cannot sign vault authorizations');
  const caps = (await provider.request(
    { method: 'capabilities' },
    { signal: options.signal, timeoutMs: Math.min(total, 15_000) },
  )) as { methods?: unknown } | null;
  if (!Array.isArray(caps?.methods) || !caps.methods.includes(method))
    throw new QlyphsError('UNSUPPORTED_METHOD', 'This wallet cannot sign vault authorizations');
  const left = total - (Date.now() - started);
  if (left < 1) throw new QlyphsError('TIMEOUT', 'Operation stopped before dispatch');
  return provider.request(
    { method, ...(params ? { params } : {}) },
    { signal: options.signal, timeoutMs: left },
  );
}
/** Errors carry no write outcome (the wallet signs, it never submits), but keep the wallet's reason. */
function readError(error: unknown): QlyphsError {
  const e = publicError(error, 'UNAVAILABLE');
  return new QlyphsError(e.code, e.message, undefined, e.reason);
}

/**
 * The connected account's ML-DSA-87 public key (0x hex, 2,592 bytes), its wallet address, and its
 * vault on the wallet's Solana deployment (base58). Needs a connected site and an unlocked wallet;
 * opens no window. The vault is checked here against the key.
 */
export async function solanaVaultPublicKey(
  provider: QlyphsProvider,
  options: RequestOptions = {},
): Promise<SolanaVaultKey> {
  try {
    const value = await ask(provider, 'solanaVaultPublicKey', undefined, options);
    let key: SolanaVaultKey;
    try {
      key = parseSolanaVaultKey(value);
    } catch {
      throw new QlyphsError('INVALID_RESPONSE', 'Invalid vault key');
    }
    const vault = await solanaVaultAddress(
      solanaVaultBytes(key.publicKey, SOLANA_VAULT_PUBLIC_KEY_BYTES),
    );
    if (base58(solanaVaultBytes(vault, 32)) !== key.vault)
      throw new QlyphsError('INVALID_RESPONSE', 'Vault does not match the key');
    return key;
  } catch (error) {
    throw readError(error);
  }
}

/** 0x or bare hex, either case, or bytes: always sent as 0x + lowercase hex, the wallet's spelling. */
function canonicalMessage(message: string | Uint8Array): string {
  if (message instanceof Uint8Array)
    return '0x' + Array.from(message, (x) => x.toString(16).padStart(2, '0')).join('');
  if (typeof message !== 'string') throw Error();
  const body = message.startsWith('0x') ? message.slice(2) : message;
  return '0x' + body.toLowerCase();
}

/** `deployments`: the allowlist checked here before asking, the vault program alone by default. */
export interface SolanaVaultSignOptions extends RequestOptions {
  readonly deployments?: readonly SolanaVaultDeployment[];
}

/**
 * Asks the wallet to sign a 296-byte vault authorization after the user reviews it in the wallet's
 * own window. The message is checked here first (format, allowlisted deployment, padding, amount,
 * lifetime): INVALID_REQUEST without asking when it fails. A site signing for another deployment
 * the wallet accepts, such as a wQTC program, names it in `options.deployments`; the wallet still
 * applies its own allowlist. Resolves with the signing key and the ML-DSA-87 signature (0x hex,
 * 2,592 and 4,627 bytes), after checking that the message's vault is this key's. USER_REJECTED when
 * the user declines.
 */
export async function signSolanaVaultAuthorization(
  provider: QlyphsProvider,
  message: string | Uint8Array,
  options: SolanaVaultSignOptions = {},
): Promise<SolanaVaultSignature> {
  let canonical: string, fields: SolanaVaultAuthorization;
  try {
    canonical = canonicalMessage(message);
    solanaVaultBytes(canonical, SOLANA_VAULT_MESSAGE_BYTES);
    fields = parseSolanaVaultAuthorization(canonical, options.deployments);
  } catch {
    throw new QlyphsError('INVALID_REQUEST', 'Invalid vault authorization');
  }
  try {
    const value = await ask(
      provider,
      'signSolanaVaultAuthorization',
      { message: canonical },
      options,
    );
    let result: SolanaVaultSignature;
    try {
      result = parseSolanaVaultSignature(value);
    } catch {
      throw new QlyphsError('INVALID_RESPONSE', 'Invalid vault signature');
    }
    const vault = await solanaVaultAddress(
      solanaVaultBytes(result.publicKey, SOLANA_VAULT_PUBLIC_KEY_BYTES),
      fields.deployment,
    );
    if (vault !== fields.vault)
      throw new QlyphsError('INVALID_RESPONSE', 'Signing key does not own this vault');
    return result;
  } catch (error) {
    throw readError(error);
  }
}
