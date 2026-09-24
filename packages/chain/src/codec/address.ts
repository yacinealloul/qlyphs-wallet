/**
 * Quantus addresses: SS58 with prefix 189 (`qz…`) over a 32-byte `AccountId32`.
 * The account id of a key is `Poseidon2(publicKey)`, which only the wasm can compute; everything
 * here works on account ids, never on ML-DSA public keys.
 */
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { QUANTUS_SS58_PREFIX } from '@qotc/shared';
import { ChainError } from '../errors';
import { bytesToHex, compareBytes, concatBytes, hexToBytes, utf8 } from './bytes';
import { blake2_256 } from './hash';
import { compactEncode, u32Le, u64Le, U64_MAX } from './scale';

export const ACCOUNT_ID_LENGTH = 32;

/** `PalletId` of the custom multisig pallet, `"py/mltsg"`. */
const MULTISIG_PALLET_ID = utf8('py/mltsg');
/** `MaxSigners` constant of the pallet. */
export const MAX_MULTISIG_SIGNERS = 100;

export function encodeAccountId(accountId: Uint8Array): string {
  if (accountId.length !== ACCOUNT_ID_LENGTH) {
    throw new ChainError('INVALID_ADDRESS', 'An account id must be exactly 32 bytes');
  }
  return encodeAddress(accountId, QUANTUS_SS58_PREFIX);
}

/** Strict decode: SS58 text only (no hex), prefix 189, valid checksum, 32 bytes, canonical form. */
export function decodeAccountId(address: string): Uint8Array {
  if (typeof address !== 'string' || address.length === 0 || address.startsWith('0x')) {
    throw new ChainError('INVALID_ADDRESS', 'Expected a Quantus SS58 address');
  }
  let accountId: Uint8Array;
  try {
    accountId = decodeAddress(address, false, QUANTUS_SS58_PREFIX);
  } catch (cause) {
    throw new ChainError('INVALID_ADDRESS', `Not a valid Quantus address: ${address}`, { cause });
  }
  if (accountId.length !== ACCOUNT_ID_LENGTH || encodeAccountId(accountId) !== address) {
    throw new ChainError('INVALID_ADDRESS', `Not a valid Quantus address: ${address}`);
  }
  return accountId;
}

export function isValidQuantusAddress(address: string): boolean {
  try {
    decodeAccountId(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * What the app sends as `sellerEscrowPubkey` is the 32-byte account id of `S_t` (see
 * `browser/keys.ts`): the pallet identifies signers by `AccountId32`, and the server cannot hash an
 * ML-DSA public key into one without the wasm. This turns that value into the `S_t` address.
 */
export function escrowAddressFromPublicKey(publicKeyHex: string): string {
  const bytes = hexToBytes(publicKeyHex);
  if (bytes.length !== ACCOUNT_ID_LENGTH) {
    throw new ChainError(
      'INVALID_ARGUMENT',
      `Escrow key must be the 32-byte account id of S_t, got ${bytes.length} bytes`,
    );
  }
  return encodeAccountId(bytes);
}

export const escrowPublicKeyFromAddress = (address: string): string =>
  bytesToHex(decodeAccountId(address));

/**
 * Deterministic multisig address, verified against the mainnet multisig
 * `qzjsuLN7…` (10 signers, threshold 6, nonce 0):
 * `blake2_256("py/mltsg" ++ SCALE(Vec<AccountId32> sorted) ++ u32_le(threshold) ++ u64_le(nonce))`.
 */
export function multisigAddress(
  signers: readonly string[],
  threshold: number,
  nonce: bigint,
): string {
  if (signers.length < 2 || signers.length > MAX_MULTISIG_SIGNERS) {
    throw new ChainError('INVALID_ARGUMENT', 'A multisig needs between 2 and 100 signers');
  }
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > signers.length) {
    throw new ChainError('INVALID_ARGUMENT', 'Threshold must be between 1 and the signer count');
  }
  if (nonce < 0n || nonce > U64_MAX) {
    throw new ChainError('INVALID_ARGUMENT', 'Multisig nonce must fit in a u64');
  }
  const ids = signers.map(decodeAccountId).sort(compareBytes);
  for (let i = 1; i < ids.length; i++) {
    const [a, b] = [ids[i - 1], ids[i]];
    if (a && b && compareBytes(a, b) === 0) {
      throw new ChainError('INVALID_ARGUMENT', 'Duplicate multisig signer');
    }
  }
  const preimage = concatBytes(
    MULTISIG_PALLET_ID,
    compactEncode(ids.length),
    ...ids,
    u32Le(threshold),
    u64Le(nonce),
  );
  return encodeAccountId(blake2_256(preimage));
}

/** Signer list in the order the pallet stores it. */
export const sortAddresses = (addresses: readonly string[]): string[] =>
  addresses
    .map((a) => ({ a, id: decodeAccountId(a) }))
    .sort((x, y) => compareBytes(x.id, y.id))
    .map((x) => x.a);
