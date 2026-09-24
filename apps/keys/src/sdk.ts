/** Dapp side of Qlyphs Keys: a QlyphsProvider backed by a keys popup. Public data only. */
import {
  CAPABILITIES,
  capabilities,
  QlyphsError,
  publicError,
  validTimeout,
} from '../../../packages/provider/src/index.ts';
import type {
  ProviderState,
  QlyphsProvider,
  RequestOptions,
  WalletAccount,
  WalletEvent,
  WalletEventMap,
} from '../../../packages/provider/src/index.ts';
import {
  KEYS_CHANNEL,
  MAX_MESSAGE,
  POPUP_HEIGHT,
  POPUP_NAME,
  POPUP_WIDTH,
  REQUEST_CHANNEL,
  RESPONSE_CHANNEL,
  connectURL,
  exactOrigin,
} from './protocol.ts';
import type { WireRequest } from './protocol.ts';
export type { ProviderState, QlyphsProvider, WalletAccount };

declare const QLYPHS_KEYS_ORIGIN: string | undefined;
declare const QLYPHS_KEYS_NETWORK: 'development' | 'mainnet' | undefined;
export const KEYS_ORIGIN =
  typeof QLYPHS_KEYS_ORIGIN === 'string' ? QLYPHS_KEYS_ORIGIN : 'https://keys.qlyphs.com';
/** The network a keys origin signs for, until the wallet reports its own: the bundled build's for
 * its own origin, otherwise the origin's kind (a production keys build is HTTPS and mainnet only). */
const builtNetwork = (keys: string): 'development' | 'mainnet' =>
  typeof QLYPHS_KEYS_NETWORK === 'string' && keys === KEYS_ORIGIN
    ? QLYPHS_KEYS_NETWORK
    : keys.startsWith('https:')
      ? 'mainnet'
      : 'development';

const READY_MS = 30_000,
  POLL_MS = 500;
const POPUPS = new Set(['connect', 'requestTransaction', 'disconnect']);
const EMPTY: ProviderState = Object.freeze({
  accounts: Object.freeze([]),
  network: null,
  connected: false,
});
// A reused popup announced itself to this page earlier; it will not announce again.
const announced = new WeakSet<object>();
if (typeof window !== 'undefined')
  window.addEventListener('message', (event) => {
    if (
      event.source &&
      exactOrigin(event.origin) &&
      event.data?.channel === KEYS_CHANNEL &&
      event.data.type === 'ready'
    )
      announced.add(event.source);
  });

const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const accountList = (v: unknown): v is WalletAccount[] =>
  Array.isArray(v) &&
  v.length <= 64 &&
  v.every(
    (a) =>
      record(a) &&
      typeof a.owner === 'string' &&
      typeof a.address === 'string' &&
      typeof a.genesis === 'string',
  );
function validState(v: unknown): ProviderState | null {
  if (
    !record(v) ||
    !accountList(v.accounts) ||
    typeof v.connected !== 'boolean' ||
    v.connected !== v.accounts.length > 0 ||
    !(v.network === null || record(v.network))
  )
    return null;
  return v as unknown as ProviderState;
}
function origin(value: string): string {
  if (typeof value !== 'string' || !exactOrigin(value))
    throw new QlyphsError('INVALID_REQUEST', 'Invalid Qlyphs Keys origin', 'not-submitted');
  if (typeof location !== 'undefined' && value === location.origin)
    throw new QlyphsError(
      'INVALID_REQUEST',
      'Qlyphs Keys must run on its own origin',
      'not-submitted',
    );
  return value;
}
function features() {
  const left = Math.max(0, Math.round(screenX + (outerWidth - POPUP_WIDTH) / 2)),
    top = Math.max(0, Math.round(screenY + (outerHeight - POPUP_HEIGHT) / 2));
  return `popup,width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`;
}
/** Opens, or reuses, the named keys window. Never noopener: the popup needs its opener. */
function openPopup(keys: string): Window | null {
  const popup = window.open('', POPUP_NAME, features());
  if (!popup) return null;
  let blank = false;
  try {
    blank = popup.location.href === 'about:blank';
  } catch {
    /* cross-origin: an existing keys window */
  }
  if (blank) popup.location.replace(connectURL(keys, location.origin));
  return popup;
}

function dead(message: string): QlyphsProvider {
  return Object.freeze({
    version: 1 as const,
    protocolVersion: 2 as const,
    request: () => Promise.reject(new QlyphsError('UNAVAILABLE', message, 'not-submitted')),
    on: () => () => {},
    removeListener: () => {},
  });
}

type Pending = {
  method: string;
  request: WireRequest;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
  writing: boolean;
  forwarded: boolean;
};

/** `eager`: the popup is opened now and the provider ends with it (openKeysProvider).
 * Otherwise it opens on the first connect/requestTransaction/disconnect and may reopen. */
function make(keys: string, eager: boolean): QlyphsProvider {
  const outstanding = new Map<string, Pending>();
  const queue: string[] = [];
  const listeners = new Map<WalletEvent, Set<(value: never) => void>>();
  const cacheKey = 'qlyphs-keys:state:v1:' + keys;
  let popup: Window | null = null,
    ready = false,
    ended = false,
    poll: ReturnType<typeof setInterval> | undefined,
    readyTimer: ReturnType<typeof setTimeout> | undefined,
    lastNetwork: ProviderState['network'] | undefined;
  let snapshot: ProviderState = (() => {
    try {
      const cached = validState(JSON.parse(localStorage.getItem(cacheKey) ?? 'null'));
      if (cached?.connected) return freeze(structuredClone(cached));
    } catch {
      /* no or unreadable cache */
    }
    return EMPTY;
  })();
  const emit = <E extends WalletEvent>(event: E, value: WalletEventMap[E]) => {
    for (const listener of [...(listeners.get(event) ?? [])]) {
      try {
        listener(value as never);
      } catch {
        /* a dapp callback cannot break other subscriptions */
      }
    }
  };
  const setState = (value: ProviderState, persist = true) => {
    const next = freeze(structuredClone(value));
    if (persist)
      try {
        if (next.connected) localStorage.setItem(cacheKey, JSON.stringify(next));
        else localStorage.removeItem(cacheKey);
      } catch {
        /* storage is a convenience, never authority */
      }
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
    const old = snapshot;
    snapshot = next;
    emit('stateChanged', next);
    if (JSON.stringify(old.accounts) !== JSON.stringify(next.accounts))
      emit('accountsChanged', next.accounts);
    if (JSON.stringify(old.network) !== JSON.stringify(next.network))
      emit('networkChanged', next.network);
    if (old.connected && !next.connected) emit('disconnect', { code: 'DISCONNECTED' });
  };
  const disconnected = () => ({ accounts: [], network: snapshot.network, connected: false });
  const settle = (id: string) => {
    const pending = outstanding.get(id);
    if (!pending) return;
    outstanding.delete(id);
    const i = queue.indexOf(id);
    if (i >= 0) queue.splice(i, 1);
    pending.cleanup();
    return pending;
  };
  const failAll = (code: 'DISCONNECTED' | 'CONTEXT_CHANGED', message: string) => {
    for (const id of [...outstanding.keys()]) {
      const p = settle(id)!;
      p.reject(
        new QlyphsError(code, message, p.writing && p.forwarded ? 'unknown' : 'not-submitted'),
      );
    }
  };
  const post = (request: WireRequest) =>
    popup!.postMessage({ channel: REQUEST_CHANNEL, request }, keys);
  const flush = () => {
    while (ready && popup && !popup.closed && queue.length) {
      const p = outstanding.get(queue.shift()!);
      if (!p) continue;
      p.forwarded = true;
      try {
        post(p.request);
      } catch {
        settle(p.request.id);
        p.reject(
          new QlyphsError(
            'DISCONNECTED',
            'Qlyphs Keys closed',
            p.writing ? 'unknown' : 'not-submitted',
          ),
        );
      }
    }
  };
  const close = (message: string) => {
    clearInterval(poll);
    clearTimeout(readyTimer);
    poll = readyTimer = undefined;
    popup = null;
    ready = false;
    failAll('DISCONNECTED', message);
    if (eager) {
      ended = true;
      // The session ends with its popup; the cache survives for the next one.
      setState(disconnected(), false);
    }
  };
  const watch = () => {
    clearInterval(poll);
    clearTimeout(readyTimer);
    ready = !!popup && announced.has(popup);
    poll = setInterval(() => {
      if (!popup || popup.closed) close('Qlyphs Keys was closed');
    }, POLL_MS);
    if (!ready)
      readyTimer = setTimeout(() => {
        if (!ready && popup) {
          try {
            popup.close();
          } catch {
            /* ignore */
          }
          close('Qlyphs Keys did not answer');
        }
      }, READY_MS);
  };
  /** Must run synchronously inside the dapp's user gesture. */
  const ensurePopup = () => {
    if (window.top !== window)
      throw new QlyphsError('UNAVAILABLE', 'Qlyphs Keys only works in a top-level page.', 'not-submitted');
    if (popup && !popup.closed) {
      try {
        popup.focus();
      } catch {
        /* focus is best effort */
      }
      return;
    }
    popup = openPopup(keys);
    if (!popup)
      throw new QlyphsError(
        'UNAVAILABLE',
        'Qlyphs Keys popup was blocked. Allow popups for this site.',
        'not-submitted',
      );
    watch();
  };

  // Ignored while a disconnect is in flight: the popup's bootstrap state still shows the grant.
  const disconnecting = () => [...outstanding.values()].some((p) => p.method === 'disconnect');
  window.addEventListener('message', (event) => {
    if (!popup || event.source !== popup || event.origin !== keys || !record(event.data)) return;
    const data = event.data;
    if (data.channel === KEYS_CHANNEL) {
      if (data.type === 'ready') {
        ready = true;
        clearTimeout(readyTimer);
        flush();
      }
      return;
    }
    if (data.channel !== RESPONSE_CHANNEL) return;
    if (data.reset === true) {
      failAll('CONTEXT_CHANGED', 'Wallet context changed. Review wallet history before retrying.');
      return;
    }
    if (data.event === 'stateChanged') {
      const state = validState(data.state);
      if (!state) return;
      lastNetwork = state.network;
      if (disconnecting()) return;
      if (state.connected) setState(state);
      // A locked wallet also reports no accounts, so keep the saved grant unless the wallet now
      // signs for another network: a grant never carries across networks (network switch).
      else if (
        snapshot.connected &&
        state.network !== null &&
        state.network.genesis !== snapshot.network?.genesis
      )
        setState({ accounts: [], network: state.network, connected: false });
      return;
    }
    if (typeof data.id !== 'string') return;
    const pending = settle(data.id);
    if (!pending) return;
    if ('error' in data) {
      const error = publicError(
        data.error,
        'VERIFICATION_FAILED',
        pending.writing ? 'unknown' : undefined,
      );
      // Any refusal of this origin (revoked grant, or a network where the site is not allowed)
      // ends the saved session, whatever the method.
      if (error.code === 'UNAUTHORIZED') setState(disconnected());
      pending.reject(error);
      return;
    }
    if (pending.method === 'connect') {
      if (!accountList(data.result) || !data.result.length) {
        pending.reject(new QlyphsError('INVALID_RESPONSE', 'Invalid wallet response'));
        return;
      }
      setState({
        accounts: data.result,
        network: lastNetwork ?? snapshot.network,
        connected: true,
      });
      pending.resolve(structuredClone(data.result));
      return;
    }
    if (pending.method === 'disconnect') setState(disconnected());
    pending.resolve(data.result);
  });

  if (eager) {
    try {
      ensurePopup();
    } catch (error) {
      return dead((error as Error).message);
    }
  }

  const provider: QlyphsProvider = Object.freeze({
    version: 1 as const,
    protocolVersion: 2 as const,
    request(
      input: { method: string; params?: unknown },
      options: RequestOptions = {},
    ): Promise<unknown> {
      const method = input && typeof input === 'object' ? input.method : undefined;
      if (!CAPABILITIES.methods.includes(method as never))
        return Promise.reject(
          new QlyphsError('UNSUPPORTED_METHOD', 'Unsupported wallet method', 'not-submitted'),
        );
      if (options.signal?.aborted)
        return Promise.reject(
          new QlyphsError('ABORTED', 'Request aborted before dispatch', 'not-submitted'),
        );
      if (method === 'capabilities') {
        const reported = (lastNetwork ?? snapshot.network)?.network;
        return Promise.resolve(
          capabilities(reported === 'development' || reported === 'mainnet' ? reported : builtNetwork(keys)),
        );
      }
      if (method === 'state') return Promise.resolve(snapshot);
      if (method === 'accounts') return Promise.resolve(snapshot.accounts);
      if (method === 'network') return Promise.resolve(snapshot.network);
      if (ended)
        return Promise.reject(
          new QlyphsError('DISCONNECTED', 'Qlyphs Keys was closed', 'not-submitted'),
        );
      if (outstanding.size >= 8)
        return Promise.reject(new QlyphsError('BUSY', 'Too many pending requests', 'not-submitted'));
      let timeout: number;
      try {
        timeout = validTimeout(options.timeoutMs, 135_000);
      } catch (error) {
        return Promise.reject(error);
      }
      const id = crypto.randomUUID(),
        writing = method === 'requestTransaction';
      const request = {
        id,
        method: method!,
        ...(input.params === undefined ? {} : { params: input.params }),
      } as WireRequest;
      try {
        if (JSON.stringify(request).length > MAX_MESSAGE) throw Error();
      } catch {
        return Promise.reject(new QlyphsError('INVALID_REQUEST', 'Invalid request', 'not-submitted'));
      }
      if (method === 'disconnect') setState(disconnected());
      // Synchronous, before any await: the popup needs the caller's user gesture.
      if (POPUPS.has(method!))
        try {
          ensurePopup();
        } catch (error) {
          if (method === 'disconnect') return Promise.resolve(true);
          return Promise.reject(error);
        }
      return new Promise((resolve, reject) => {
        const stop = (code: 'TIMEOUT' | 'ABORTED') => {
          const pending = settle(id);
          if (!pending) return;
          if (pending.forwarded && ready && popup && !popup.closed)
            try {
              post({ id: crypto.randomUUID(), method: 'cancelRequest', target: id });
            } catch {
              /* cancellation is best effort, never a rollback */
            }
          reject(
            new QlyphsError(
              code,
              'Request stopped. Check wallet history; do not automatically repeat a payment.',
              writing && pending.forwarded ? 'unknown' : 'not-submitted',
            ),
          );
        };
        const abort = () => stop('ABORTED');
        const timer = setTimeout(() => stop('TIMEOUT'), timeout);
        const cleanup = () => {
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', abort);
        };
        outstanding.set(id, {
          method: method!,
          request,
          resolve,
          reject,
          cleanup,
          writing,
          forwarded: false,
        });
        queue.push(id);
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) {
          stop('ABORTED');
          return;
        }
        flush();
      });
    },
    on(event: WalletEvent, listener: (value: never) => void) {
      if (!CAPABILITIES.events.includes(event) || typeof listener !== 'function')
        throw new QlyphsError('INVALID_REQUEST', 'Unknown event or invalid listener');
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        set!.delete(listener);
        if (!set!.size && listeners.get(event) === set) listeners.delete(event);
      };
    },
    removeListener(event: WalletEvent, listener: (value: never) => void) {
      listeners.get(event)?.delete(listener);
    },
  });
  return provider;
}

/** Opens Qlyphs Keys now; call it synchronously from a click. The provider ends with the popup. */
export function openKeysProvider(options: { origin: string }): QlyphsProvider {
  return make(origin(options?.origin), true);
}

/** Opens Qlyphs Keys on the first connect, requestTransaction or disconnect; reopens when needed.
 * Between popups the provider has no channel to the wallet: its state is the last one it saw and
 * may be out of date (another tab disconnected it, the wallet switched network). It is corrected
 * on the next popup: an UNAUTHORIZED answer or a state for another network ends the session with
 * a disconnect event. */
export function createKeysProvider(options: { origin?: string } = {}): QlyphsProvider {
  return make(origin(options.origin ?? KEYS_ORIGIN), false);
}

/** The extension wins when it is installed. */
export function installKeysProvider(options: { origin?: string } = {}): QlyphsProvider | null {
  if (Object.hasOwn(window, 'qlyphs')) return null;
  const value = createKeysProvider(options);
  Object.defineProperty(window, 'qlyphs', {
    value,
    writable: false,
    configurable: false,
    enumerable: true,
  });
  window.dispatchEvent(new Event('qlyphs:initialized'));
  return value;
}
