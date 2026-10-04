/** Wire contract between a dapp window and the keys popup. Public data only, never secrets. */
import type {
  MintSessionSnapshot,
  ProviderState,
  PublicErrorData,
} from '../../../packages/provider/src/index.ts';
export const KEYS_CHANNEL = 'qlyphs:keys:1';
export const REQUEST_CHANNEL = 'qlyphs:request:1';
export const RESPONSE_CHANNEL = 'qlyphs:response:1';
export const MAX_MESSAGE = 8192;
export const POPUP_NAME = 'qlyphs-keys';
export const POPUP_WIDTH = 480;
export const POPUP_HEIGHT = 740;
export const connectURL = (keysOrigin: string, dappOrigin: string) =>
  keysOrigin + '/connect?origin=' + encodeURIComponent(dappOrigin);
/** Exact origin: https, or loopback http; no path, query, credentials or trailing slash. */
export function exactOrigin(value: string): boolean {
  try {
    const u = new URL(value);
    return u.origin === value && (u.protocol === 'https:' ||
      (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)));
  } catch { return false; }
}
/** popup -> opener, targetOrigin = verified dapp origin. Sent when a popup document can accept
 * requests, and again for each DappHello. `documentId` is random per popup document: the same value
 * is the same document, another value a document that replaced it. Popups older than this field
 * omit it and announce only once per document, so another one from them always means a new document. */
export type PopupReady = { channel: typeof KEYS_CHANNEL; type: 'ready'; documentId?: string };
/** popup -> opener, targetOrigin = verified dapp origin. Sent when the popup document goes away
 * (closed, reloaded or navigated), after its wallet channel closed: it answers nothing more. */
export type PopupLeave = { channel: typeof KEYS_CHANNEL; type: 'leave' };
/** opener -> popup, targetOrigin = keys origin. Sent by a dapp page that reuses an open popup it has
 * not seen announce itself, such as a page reloaded while the popup stayed open: the popup document
 * answers with a PopupReady. */
export type DappHello = { channel: typeof KEYS_CHANNEL; type: 'hello' };
/** What connect.ts puts in `documentId` (a random UUID), checked before a dapp relies on it. */
export const validDocumentId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(value);
/** opener -> popup, targetOrigin = keys origin. `request` is exactly what provider.ts sends today. */
export type WireRequest =
  | { id: string; method: string }
  | { id: string; method: 'requestTransaction'; params: unknown }
  | { id: string; method: 'requestMintSession' | 'stopMintSession'; params: unknown }
  | { id: string; method: 'cancelRequest'; target: string };
export type DappRequest = { channel: typeof REQUEST_CHANNEL; request: WireRequest };
export type DappMessage = DappHello | DappRequest;
/** popup -> opener, targetOrigin = verified dapp origin. Same envelopes content.ts relays today. */
export type PopupResponse =
  | { channel: typeof RESPONSE_CHANNEL; id: string; result: unknown }
  | { channel: typeof RESPONSE_CHANNEL; id: string; error: PublicErrorData }
  | { channel: typeof RESPONSE_CHANNEL; event: 'stateChanged'; state: ProviderState }
  | { channel: typeof RESPONSE_CHANNEL; event: 'mintSessionChanged'; session: MintSessionSnapshot | null }
  | { channel: typeof RESPONSE_CHANNEL; reset: true };
export type PopupMessage = PopupReady | PopupLeave | PopupResponse;
