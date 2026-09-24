/**
 * Signed extrinsic (v4) assembly and parsing for Quantus. Mirrors `quantus-wasm/src/ext.rs`; the
 * tests check byte equality with extrinsics produced by `@quantus-network/wasm` itself.
 *
 * ```
 * extra    = Era ++ Compact(nonce) ++ Compact(tip) ++ 0x00            (CheckMetadataHash: disabled)
 * implicit = specVersion u32le ++ txVersion u32le ++ genesisHash ++ eraBlockHash ++ 0x00 (None)
 * payload  = call ++ extra ++ implicit; signed as blake2_256(payload) when longer than 256 bytes
 * xt       = Compact(len) ++ 0x84 ++ 0x00 ++ accountId ++ scheme ++ signature ++ publicKey ++ extra ++ call
 * ```
 */
import { ChainError } from '../errors';
import { bytesToHex, concatBytes, hexToBytes, utf8 } from './bytes';
import { blake2_256, blake2_256Hex } from './hash';
import { compactEncode, ScaleReader, u32Le } from './scale';

/** FIPS 204 context string every extrinsic signature is bound to. */
export const SIGNING_CONTEXT = utf8('QUANTUS_EXTRINSIC');

const EXTRINSIC_V4_SIGNED = 0x84;
const MULTI_ADDRESS_ID = 0x00;
const METADATA_HASH_DISABLED = 0x00;
const MAX_UNHASHED_PAYLOAD = 256;

export type SignatureScheme = 'ml-dsa-87' | 'ml-dsa-65';

interface SchemeLayout {
  variant: number;
  signatureLength: number;
  publicKeyLength: number;
}

/**
 * ML-DSA-87 sizes are VERIFIED (4627 + 2592 = 7219, metadata type `[u8; 7219]`).
 * ML-DSA-65 sizes are ASSUMED from FIPS 204 (3309 + 1952 = 5261); they are only used when parsing
 * other people's extrinsics, never for signing.
 */
export function schemeLayout(scheme: SignatureScheme): SchemeLayout {
  return scheme === 'ml-dsa-87'
    ? { variant: 0x00, signatureLength: 4627, publicKeyLength: 2592 }
    : { variant: 0x01, signatureLength: 3309, publicKeyLength: 1952 };
}

export type Era =
  { kind: 'immortal' } | { kind: 'mortal'; period: number; blockNumber: number; blockHash: string };

export interface SigningContext {
  nonce: number;
  /** planck; 0 unless the caller wants priority. */
  tip?: bigint;
  era: Era;
  genesisHash: string;
  specVersion: number;
  transactionVersion: number;
}

/**
 * Mortal era bytes. The period must be a power of two in 4..4096: within that range the quantize
 * factor is 1, so the era's birth block is exactly `blockNumber` and its hash is the checkpoint.
 */
export function encodeEra(era: Era): Uint8Array {
  if (era.kind === 'immortal') return Uint8Array.of(0x00);
  const { period, blockNumber } = era;
  const isPowerOfTwo = Number.isInteger(period) && (period & (period - 1)) === 0;
  if (!isPowerOfTwo || period < 4 || period > 4096) {
    throw new ChainError('INVALID_ARGUMENT', 'Era period must be a power of two in 4..4096');
  }
  if (!Number.isInteger(blockNumber) || blockNumber < 0) {
    throw new ChainError('INVALID_ARGUMENT', 'Era block number must be a non-negative integer');
  }
  const trailingZeros = Math.log2(period);
  const phase = blockNumber % period;
  const encoded = Math.min(15, Math.max(1, trailingZeros - 1)) | (phase << 4);
  return Uint8Array.of(encoded & 0xff, encoded >> 8);
}

function hash32(hex: string, what: string): Uint8Array {
  const bytes = hexToBytes(hex);
  if (bytes.length !== 32) throw new ChainError('INVALID_ARGUMENT', `${what} must be 32 bytes`);
  return bytes;
}

export interface SigningPayload {
  extra: Uint8Array;
  payload: Uint8Array;
  /** Exactly what the key signs under {@link SIGNING_CONTEXT}. */
  message: Uint8Array;
}

export function buildSigningPayload(call: Uint8Array, ctx: SigningContext): SigningPayload {
  if (!Number.isInteger(ctx.nonce) || ctx.nonce < 0) {
    throw new ChainError('INVALID_ARGUMENT', 'Nonce must be a non-negative integer');
  }
  const genesis = hash32(ctx.genesisHash, 'genesisHash');
  const checkpoint = ctx.era.kind === 'immortal' ? genesis : hash32(ctx.era.blockHash, 'blockHash');
  const extra = concatBytes(
    encodeEra(ctx.era),
    compactEncode(ctx.nonce),
    compactEncode(ctx.tip ?? 0n),
    Uint8Array.of(METADATA_HASH_DISABLED),
  );
  const implicit = concatBytes(
    u32Le(ctx.specVersion),
    u32Le(ctx.transactionVersion),
    genesis,
    checkpoint,
    Uint8Array.of(0x00),
  );
  const payload = concatBytes(call, extra, implicit);
  const message = payload.length > MAX_UNHASHED_PAYLOAD ? blake2_256(payload) : payload;
  return { extra, payload, message };
}

export function assembleExtrinsic(p: {
  accountId: Uint8Array;
  scheme: SignatureScheme;
  signature: Uint8Array;
  publicKey: Uint8Array;
  extra: Uint8Array;
  call: Uint8Array;
}): Uint8Array {
  const layout = schemeLayout(p.scheme);
  if (p.accountId.length !== 32)
    throw new ChainError('INVALID_ARGUMENT', 'accountId must be 32 bytes');
  if (p.signature.length !== layout.signatureLength) {
    throw new ChainError('INVALID_ARGUMENT', `Signature must be ${layout.signatureLength} bytes`);
  }
  if (p.publicKey.length !== layout.publicKeyLength) {
    throw new ChainError('INVALID_ARGUMENT', `Public key must be ${layout.publicKeyLength} bytes`);
  }
  const body = concatBytes(
    Uint8Array.of(EXTRINSIC_V4_SIGNED, MULTI_ADDRESS_ID),
    p.accountId,
    Uint8Array.of(layout.variant),
    p.signature,
    p.publicKey,
    p.extra,
    p.call,
  );
  return concatBytes(compactEncode(body.length), body);
}

export interface ParsedExtrinsic {
  accountId: Uint8Array;
  scheme: SignatureScheme;
  signature: Uint8Array;
  publicKey: Uint8Array;
  eraBytes: Uint8Array;
  nonce: number;
  tip: bigint;
  call: Uint8Array;
}

/** Inverse of {@link assembleExtrinsic}; polkadot.js cannot decode these (signature > 2048 bytes). */
export function parseSignedExtrinsic(bytes: Uint8Array | string): ParsedExtrinsic {
  const outer = new ScaleReader(typeof bytes === 'string' ? hexToBytes(bytes) : bytes);
  const body = outer.lengthPrefixedBytes();
  outer.assertEnd('extrinsic');
  const r = new ScaleReader(body);
  if (r.u8() !== EXTRINSIC_V4_SIGNED)
    throw new ChainError('INVALID_CALL', 'Not a signed v4 extrinsic');
  if (r.u8() !== MULTI_ADDRESS_ID)
    throw new ChainError('INVALID_CALL', 'Unsupported signer address type');
  const accountId = r.bytes(32);
  const variant = r.u8();
  if (variant !== 0 && variant !== 1) {
    throw new ChainError('INVALID_CALL', `Unknown signature scheme variant ${variant}`);
  }
  const scheme: SignatureScheme = variant === 0 ? 'ml-dsa-87' : 'ml-dsa-65';
  const layout = schemeLayout(scheme);
  const signature = r.bytes(layout.signatureLength);
  const publicKey = r.bytes(layout.publicKeyLength);
  const eraStart = r.position;
  const eraFirst = r.u8();
  if (eraFirst !== 0) r.u8();
  const eraBytes = body.slice(eraStart, r.position);
  const nonce = Number(r.compact());
  const tip = r.compact();
  if (r.u8() !== METADATA_HASH_DISABLED) {
    throw new ChainError('INVALID_CALL', 'Unsupported CheckMetadataHash mode');
  }
  return {
    accountId,
    scheme,
    signature,
    publicKey,
    eraBytes,
    nonce,
    tip,
    call: r.bytes(r.remaining),
  };
}

/** ASSUMED to be what `author_submitExtrinsic` returns; we always compute it locally as well. */
export const extrinsicHash = (extrinsic: Uint8Array): string => blake2_256Hex(extrinsic);

export const extrinsicToHex = (extrinsic: Uint8Array): string => bytesToHex(extrinsic);
