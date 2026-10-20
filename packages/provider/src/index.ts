/** Public contracts only. Safe to import in browsers, Node and framework renderers. */
import type { Manifest, NetworkName } from '../../native/src/network.ts';
import type { SubmittedTransaction, TransactionCommand } from '../../native/src/public.ts';
import { MINT_SESSION_LIMITS } from './mint-session.ts';
import type { MintSessionLimits, MintSessionParams, MintSessionSnapshot } from './mint-session.ts';
import type { SiteSessionProof } from './site-session.ts';
import { failureReason, reasonRetryable, reasonText } from './reasons.ts';
import type { FailureReason } from './reasons.ts';
export type { Manifest, SubmittedTransaction, TransactionCommand };
export * from './mint-session.ts';
export * from './site-session.ts';
export * from './reasons.ts';
import { SOLANA_VAULT_METHODS } from './solana-vault.ts';
import type { SolanaVaultKey, SolanaVaultSignature } from './solana-vault.ts';
export * from './solana-vault.ts';
export interface WalletAccount {
  readonly owner: string;
  readonly address: string;
  readonly genesis: string;
}
export const PUBLIC_ERROR_CODES = [
  'USER_REJECTED',
  'UNAUTHORIZED',
  'INVALID_REQUEST',
  'UNSUPPORTED_METHOD',
  'BUSY',
  'CONTEXT_CHANGED',
  'DISCONNECTED',
  'TIMEOUT',
  'ABORTED',
  'VERIFICATION_FAILED',
  'UNAVAILABLE',
  'INVALID_RESPONSE',
  'NETWORK_MISMATCH',
] as const;
export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];
export type WriteOutcome = 'not-submitted' | 'unknown';
/** `reason` and `retryable` are optional: wallets older than them send neither, and a reason is only
 * ever one of FAILURE_REASONS. `retryable` is derived from the reason and the outcome, never taken
 * from the wire. */
export interface PublicErrorData {
  code: PublicErrorCode;
  message: string;
  outcome?: WriteOutcome;
  reason?: FailureReason;
  retryable?: boolean;
}
export class QlyphsError extends Error {
  readonly code: PublicErrorCode;
  readonly outcome?: WriteOutcome;
  /** Why it failed, when the wallet knows: one of FAILURE_REASONS. */
  readonly reason?: FailureReason;
  /** Present with `reason`: whether a new request can succeed, possibly after the action its text
   * names. Never true for an unknown outcome. The SDK still never retries a write by itself. */
  readonly retryable?: boolean;
  constructor(code: PublicErrorCode, message: string, outcome?: WriteOutcome, reason?: FailureReason) {
    super(message);
    this.name = 'QlyphsError';
    this.code = code;
    this.outcome = outcome;
    const known = failureReason(reason);
    if (known) {
      this.reason = known;
      this.retryable = reasonRetryable(known, outcome);
    }
  }
}
const UNKNOWN_OUTCOME = ' It may already have been sent: check the wallet history before trying again.';
/** Do not reflect remote exception strings, stack traces, or privileged details. Only the code, the
 * outcome and a reason from FAILURE_REASONS cross; `reason` applies when the value names none. */
export function publicError(
  value: unknown,
  fallback: PublicErrorCode = 'UNAVAILABLE',
  outcome?: WriteOutcome,
  reason?: FailureReason,
): QlyphsError {
  const x = value as Partial<PublicErrorData> | null;
  const code = x && PUBLIC_ERROR_CODES.includes(x.code as PublicErrorCode) ? x.code! : fallback;
  const knownOutcome =
    x?.outcome === 'unknown' || x?.outcome === 'not-submitted' ? x.outcome : outcome;
  const why = failureReason(x?.reason) ?? failureReason(reason);
  return new QlyphsError(
    code,
    why
      ? // A reason's text may invite a retry; a write that may already be on the network must not.
        `Qlyphs: ${reasonText(why)}${knownOutcome === 'unknown' ? UNKNOWN_OUTCOME : ''}`
      : `Qlyphs: ${code.toLowerCase().replaceAll('_', ' ')}. No automatic write retry.`,
    knownOutcome,
    why,
  );
}
/** The error as it crosses a channel: plain data, reason and retryable only when known. */
export function wireError(error: QlyphsError): PublicErrorData {
  return {
    code: error.code,
    message: error.message,
    ...(error.outcome ? { outcome: error.outcome } : {}),
    ...(error.reason ? { reason: error.reason, retryable: error.retryable === true } : {}),
  };
}
const BASE_METHODS = [
  'capabilities',
  'state',
  'connect',
  'accounts',
  'network',
  'disconnect',
  'requestTransaction',
  'signSessionChallenge',
] as const;
const BASE_EVENTS = ['stateChanged', 'accountsChanged', 'networkChanged', 'disconnect'] as const;
const SESSION_METHODS = ['requestMintSession', 'mintSession', 'stopMintSession'] as const;
const SESSION_EVENTS = ['mintSessionChanged'] as const;
/**
 * What a wallet build advertises; `network` is the one network that build signs for.
 * `mintSessions` is null where the build cannot run mint sessions, and then the session methods and
 * event are not listed. The limits are the same on every network, but the default fails closed on
 * mainnet: a mainnet wallet passes them explicitly once its own checks allow sessions. Older wallets
 * omit the field. `solanaVault` is true only in development builds that serve the Solana vault
 * methods (solana-vault.ts); other builds advertise exactly what they did before those existed.
 */
export const capabilities = (
  network: NetworkName,
  mintSessions: MintSessionLimits | null = network === 'development' ? MINT_SESSION_LIMITS : null,
  solanaVault = false,
) =>
  Object.freeze({
    protocolVersion: 2 as const,
    network,
    methods: Object.freeze([
      ...BASE_METHODS,
      ...(mintSessions ? SESSION_METHODS : []),
      ...(solanaVault ? SOLANA_VAULT_METHODS : []),
    ]),
    events: Object.freeze([...BASE_EVENTS, ...(mintSessions ? SESSION_EVENTS : [])]),
    cancellation: true,
    arbitraryRpc: false,
    persistentSigning: false,
    mintSessions,
  });
/** Every method and event a page-side provider may forward; the wallet decides what it serves. */
export const CAPABILITIES = capabilities('development');
export type WalletCapabilities = ReturnType<typeof capabilities>;
/** Disconnected is intentionally indistinguishable from locked or unconfigured to an unapproved origin. */
export interface ProviderState {
  readonly accounts: readonly WalletAccount[];
  readonly network: Manifest | null;
  readonly connected: boolean;
}
export interface WalletEventMap {
  stateChanged: ProviderState;
  accountsChanged: readonly WalletAccount[];
  networkChanged: Manifest | null;
  disconnect: { readonly code: 'CONTEXT_CHANGED' | 'DISCONNECTED' };
  /** Sent only to the channel that created the session; equals the `mintSession` read. */
  mintSessionChanged: MintSessionSnapshot | null;
}
export type WalletEvent = keyof WalletEventMap;
export type WalletListener<E extends WalletEvent> = (value: WalletEventMap[E]) => void;
export interface WalletRequestMap {
  capabilities: { params: never; result: WalletCapabilities };
  state: { params: never; result: ProviderState };
  connect: { params: never; result: WalletAccount[] };
  accounts: { params: never; result: WalletAccount[] };
  network: { params: never; result: Manifest | null };
  disconnect: { params: never; result: true };
  requestTransaction: {
    params: { owner: string; genesis: string; command: TransactionCommand };
    result: SubmittedTransaction;
  };
  /** Resolves at approval with the running snapshot, never when the session ends. */
  requestMintSession: { params: MintSessionParams; result: MintSessionSnapshot };
  mintSession: { params: never; result: MintSessionSnapshot | null };
  /** Only reduces authority, so it is safe to retry. */
  stopMintSession: { params: { session: string }; result: MintSessionSnapshot | null };
  /** Signs a site session challenge (site-session.ts) after a private review; moves no funds.
   * Wallets older than this method do not list it in `capabilities`. */
  signSessionChallenge: { params: { challenge: string }; result: SiteSessionProof };
  /** Development builds only (solana-vault.ts): the connected account's ML-DSA-87 key and vault. */
  solanaVaultPublicKey: { params: never; result: SolanaVaultKey };
  /** Development builds only: signs a 296-byte vault authorization after a review in the wallet. */
  signSolanaVaultAuthorization: { params: { message: string }; result: SolanaVaultSignature };
}
export type WalletMethod = keyof WalletRequestMap;
export type RequestInput<M extends WalletMethod> = {
  method: M;
} & (WalletRequestMap[M]['params'] extends never
  ? { params?: never }
  : { params: WalletRequestMap[M]['params'] });
export interface RequestOptions {
  signal?: AbortSignal;
  /** Positive milliseconds, at most 135,000; connect alone permits 600,000 for setup. */
  timeoutMs?: number;
}
/** v1 is intentionally retained for existing callers. Feature-detect protocolVersion/on. */
export interface QlyphsProvider {
  readonly version: 1;
  readonly protocolVersion?: 2;
  request(input: { method: string; params?: unknown }, options?: RequestOptions): Promise<unknown>;
  on?<E extends WalletEvent>(event: E, listener: WalletListener<E>): () => void;
  removeListener?<E extends WalletEvent>(event: E, listener: WalletListener<E>): void;
}
export function isProvider(value: unknown): value is QlyphsProvider {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as QlyphsProvider).version === 1 &&
    typeof (value as QlyphsProvider).request === 'function'
  );
}
export function validTimeout(value: number | undefined, fallback: number, max = 135_000): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n <= 0 || n > max)
    throw new QlyphsError(
      'INVALID_REQUEST',
      `Timeout must be an integer from 1 to ${max} milliseconds`,
      'not-submitted',
    );
  return n;
}
