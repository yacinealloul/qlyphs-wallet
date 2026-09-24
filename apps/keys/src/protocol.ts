/** Wire contract between a dapp window and the keys popup. Public data only, never secrets. */
import type { ProviderState, PublicErrorData } from '../../../packages/provider/src/index.ts';
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
/** popup -> opener, targetOrigin = verified dapp origin. Sent once the popup can accept requests. */
export type PopupReady = { channel: typeof KEYS_CHANNEL; type: 'ready' };
/** opener -> popup, targetOrigin = keys origin. `request` is exactly what provider.ts sends today. */
export type WireRequest =
  | { id: string; method: string }
  | { id: string; method: 'requestTransaction'; params: unknown }
  | { id: string; method: 'cancelRequest'; target: string };
export type DappRequest = { channel: typeof REQUEST_CHANNEL; request: WireRequest };
/** popup -> opener, targetOrigin = verified dapp origin. Same envelopes content.ts relays today. */
export type PopupResponse =
  | { channel: typeof RESPONSE_CHANNEL; id: string; result: unknown }
  | { channel: typeof RESPONSE_CHANNEL; id: string; error: PublicErrorData }
  | { channel: typeof RESPONSE_CHANNEL; event: 'stateChanged'; state: ProviderState }
  | { channel: typeof RESPONSE_CHANNEL; reset: true };
export type PopupMessage = PopupReady | PopupResponse;
