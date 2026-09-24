/** Public contracts only. Safe to import in browsers, Node and framework renderers. */
import type { Manifest, NetworkName } from '../../native/src/network.ts';
import type { SubmittedTransaction, TransactionCommand } from '../../native/src/public.ts';
export type { Manifest, SubmittedTransaction, TransactionCommand };
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
export interface PublicErrorData {
  code: PublicErrorCode;
  message: string;
  outcome?: WriteOutcome;
}
export class QlyphsError extends Error {
  readonly code: PublicErrorCode;
  readonly outcome?: WriteOutcome;
  constructor(code: PublicErrorCode, message: string, outcome?: WriteOutcome) {
    super(message);
    this.name = 'QlyphsError';
    this.code = code;
    this.outcome = outcome;
  }
}
/** Do not reflect remote exception strings, stack traces, or privileged details. */
export function publicError(
  value: unknown,
  fallback: PublicErrorCode = 'UNAVAILABLE',
  outcome?: WriteOutcome,
): QlyphsError {
  const x = value as Partial<PublicErrorData> | null;
  const code = x && PUBLIC_ERROR_CODES.includes(x.code as PublicErrorCode) ? x.code! : fallback;
  const knownOutcome =
    x?.outcome === 'unknown' || x?.outcome === 'not-submitted' ? x.outcome : outcome;
  return new QlyphsError(
    code,
    `Qlyphs: ${code.toLowerCase().replaceAll('_', ' ')}. No automatic write retry.`,
    knownOutcome,
  );
}
/** What a wallet build advertises; `network` is the one network that build signs for. */
export const capabilities = (network: NetworkName) =>
  Object.freeze({
    protocolVersion: 2 as const,
    network,
    methods: Object.freeze([
      'capabilities',
      'state',
      'connect',
      'accounts',
      'network',
      'disconnect',
      'requestTransaction',
    ] as const),
    events: Object.freeze([
      'stateChanged',
      'accountsChanged',
      'networkChanged',
      'disconnect',
    ] as const),
    cancellation: true,
    arbitraryRpc: false,
    persistentSigning: false,
  });
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
}
export type WalletMethod = keyof WalletRequestMap;
export type RequestInput<M extends WalletMethod> = {
  method: M;
} & (WalletRequestMap[M]['params'] extends never
  ? { params?: never }
  : { params: WalletRequestMap[M]['params'] });
export interface RequestOptions {
  signal?: AbortSignal;
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
