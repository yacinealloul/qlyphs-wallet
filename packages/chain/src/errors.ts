/**
 * Errors raised by `@qotc/chain`. The API maps them onto its own error envelope
 * (`CHAIN_UNAVAILABLE`, `ESCROW_MISMATCH`, …); nothing here depends on HTTP.
 */
export const CHAIN_ERROR_CODES = [
  'INVALID_ADDRESS',
  'INVALID_ARGUMENT',
  'INVALID_CALL',
  'INVALID_MNEMONIC',
  /** Transport-level: endpoint unreachable, socket closed, request timed out. Safe to retry. */
  'RPC_UNAVAILABLE',
  /** The node answered with a JSON-RPC error. */
  'RPC_ERROR',
  'RUNTIME_MISMATCH',
  /** The node refused the extrinsic (bad proof, stale nonce, cannot pay fees…). Nothing was included. */
  'TX_REJECTED',
  /** The extrinsic was not seen in a block before the deadline. Its fate is unknown. */
  'TX_NOT_INCLUDED',
  /** Included, but the dispatch failed (`System.ExtrinsicFailed`) or had no effect. */
  'TX_FAILED',
  /** `multisig.execute` was included and consumed the proposal, but the inner call failed. */
  'INNER_CALL_FAILED',
  'MULTISIG_MISMATCH',
  'PROPOSAL_NOT_FOUND',
  'PROPOSAL_EXPIRED',
  'CALL_MISMATCH',
  'INSUFFICIENT_BALANCE',
  /** A transfer leg would leave its destination below the existential deposit. Nothing was sent. */
  'BELOW_EXISTENTIAL_DEPOSIT',
  'WASM_LOAD_FAILED',
  'MOCK_BACKEND',
] as const;

export type ChainErrorCode = (typeof CHAIN_ERROR_CODES)[number];

export interface ChainErrorDetails {
  /** Hashes of extrinsics that were already included when the error happened. */
  txHashes?: string[];
  /** Pallet or dispatch error name reported by the chain, when known. */
  dispatchError?: string;
  cause?: unknown;
}

export class ChainError extends Error {
  readonly code: ChainErrorCode;
  readonly txHashes: readonly string[];
  readonly dispatchError: string | null;

  constructor(code: ChainErrorCode, message: string, details: ChainErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'ChainError';
    this.code = code;
    this.txHashes = details.txHashes ?? [];
    this.dispatchError = details.dispatchError ?? null;
  }

  /** True when retrying the same operation later is reasonable. */
  get retryable(): boolean {
    return this.code === 'RPC_UNAVAILABLE' || this.code === 'TX_NOT_INCLUDED';
  }
}

export const isChainError = (e: unknown): e is ChainError => e instanceof ChainError;
