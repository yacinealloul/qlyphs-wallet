/** Dapp side of Qlyphs Keys: a QlyphsProvider backed by a keys popup. Public data only. */
import {
  CAPABILITIES,
  capabilities,
  parseMintSessionSnapshot,
  QlyphsError,
  publicError,
  validTimeout,
} from '../../../packages/provider/src/index.ts';
import type {
  MintSessionSnapshot,
  ProviderState,
  QlyphsProvider,
  RequestOptions,
  WalletAccount,
  WalletEvent,
  WalletEventMap,
  WriteOutcome,
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
  validDocumentId,
} from './protocol.ts';
import type { DappHello, WireRequest } from './protocol.ts';
import { pageFacts, sessionsSupported } from './session-browser.ts';
export type { ProviderState, QlyphsProvider, WalletAccount };

declare const QLYPHS_KEYS_ORIGIN: string | undefined;
declare const QLYPHS_KEYS_NETWORK: 'development' | 'mainnet' | undefined;
export const KEYS_ORIGIN =
  typeof QLYPHS_KEYS_ORIGIN === 'string' ? QLYPHS_KEYS_ORIGIN : 'https://keys.qlyphs.com';
/** The network a keys origin signs for, until the wallet reports its own: the bundled build's for
 * its own origin, otherwise the origin's kind (a production keys build is HTTPS and mainnet only). */
type KeysNetwork = 'development' | 'mainnet';
const builtNetwork = (keys: string): KeysNetwork =>
  typeof QLYPHS_KEYS_NETWORK === 'string' && keys === KEYS_ORIGIN
    ? QLYPHS_KEYS_NETWORK
    : keys.startsWith('https:')
      ? 'mainnet'
      : 'development';

// Keys runs mint sessions only in some browsers (session-browser.ts). This page runs in the same
// browser as the wallet, so it can tell a dapp not to offer them; the wallet still decides.
let sessionBrowser: boolean | undefined;
const browserRunsSessions = () => (sessionBrowser ??= sessionsSupported(pageFacts()));

const READY_MS = 30_000,
  POLL_MS = 500;
const POPUPS = new Set(['connect', 'requestTransaction', 'requestMintSession', 'disconnect']);
const WRITES = new Set(['requestTransaction', 'requestMintSession']);
// Bound to the popup page's channel, so they answer null without asking the wallet until that page
// has announced itself to this provider; a session may still run there.
const SESSION_READS = new Set(['mintSession', 'stopMintSession']);
const EMPTY: ProviderState = Object.freeze({
  accounts: Object.freeze([]),
  network: null,
  connected: false,
});
/** The document a popup's announcement names; null for a popup too old to name one, undefined for a
 * malformed announcement, which is ignored. */
function announcedDocument(data: { documentId?: unknown }): string | null | undefined {
  if (data.documentId === undefined) return null;
  return validDocumentId(data.documentId) ? data.documentId : undefined;
}
// The document each popup last announced to this page, and the origin it announced from. A popup
// announces a document when it loads and when a page asks (hello), so a page reloaded under an open
// popup has to ask. The origin is kept because any page can post to this one: only an announcement
// from a provider's keys origin counts for that provider.
const announced = new WeakMap<object, { origin: string; id: string | null }>();
if (typeof window !== 'undefined')
  window.addEventListener('message', (event) => {
    if (!event.source || !exactOrigin(event.origin) || event.data?.channel !== KEYS_CHANNEL) return;
    if (event.data.type === 'ready') {
      const id = announcedDocument(event.data);
      if (id !== undefined) announced.set(event.source, { origin: event.origin, id });
    } else if (event.data.type === 'leave') announced.delete(event.source);
  });
/** The document `popup` last announced to this page from `keys`; undefined when it has not. */
function announcedBy(popup: object, keys: string): string | null | undefined {
  const entry = announced.get(popup);
  return entry?.origin === keys ? entry.id : undefined;
}

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
/** A snapshot from the wallet, or null; anything malformed is undefined and ignored. */
function sessionSnapshot(value: unknown): MintSessionSnapshot | null | undefined {
  if (value === null) return null;
  try {
    return parseMintSessionSnapshot(value);
  } catch {
    return undefined;
  }
}
const live = (s: MintSessionSnapshot | null) => !!s && s.state !== 'ended';
function network(value: unknown): KeysNetwork | undefined {
  if (value === undefined || value === 'development' || value === 'mainnet') return value;
  throw new QlyphsError('INVALID_REQUEST', 'Invalid Qlyphs Keys network', 'not-submitted');
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
  // Its document announced itself when it loaded, maybe to a page this one replaced (a reload of
  // the dapp): ask it again. Addressed to the keys origin, so a window showing anything else never
  // receives it.
  else if (announcedBy(popup, keys) === undefined)
    try {
      popup.postMessage({ channel: KEYS_CHANNEL, type: 'hello' } satisfies DappHello, keys);
    } catch {
      /* unanswered, like a silent document: the ready deadline closes the window */
    }
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
 * Otherwise it opens on the first connect, requestTransaction, requestMintSession or disconnect and
 * may reopen. A mint session is bound to the popup's channel: closing or reloading the popup stops
 * it. `declared`: the network the dapp says this keys origin signs for, used until the wallet
 * reports its own. */
function make(keys: string, eager: boolean, declared?: KeysNetwork): QlyphsProvider {
  const outstanding = new Map<string, Pending>();
  const queue: string[] = [];
  const listeners = new Map<WalletEvent, Set<(value: never) => void>>();
  const cacheKey = 'qlyphs-keys:state:v1:' + keys;
  let popup: Window | null = null,
    ready = false,
    // The popup document this provider last saw announced: null when it named none (an older
    // popup), undefined while no document of the current window has.
    known: string | null | undefined,
    ended = false,
    poll: ReturnType<typeof setInterval> | undefined,
    readyTimer: ReturnType<typeof setTimeout> | undefined,
    lastNetwork: ProviderState['network'] | undefined,
    // The mint session this provider's channel created, as the wallet last reported it.
    session: MintSessionSnapshot | null = null;
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
  const setSession = (value: MintSessionSnapshot | null) => {
    if (JSON.stringify(value) === JSON.stringify(session)) return;
    session = value;
    emit('mintSessionChanged', value);
  };
  const disconnected = () => ({ accounts: [], network: snapshot.network, connected: false });
  const current = () => {
    const reported = (lastNetwork ?? snapshot.network)?.network;
    const network =
      reported === 'development' || reported === 'mainnet' ? reported : (declared ?? builtNetwork(keys));
    return browserRunsSessions() ? capabilities(network) : capabilities(network, null);
  };
  const settle = (id: string) => {
    const pending = outstanding.get(id);
    if (!pending) return;
    outstanding.delete(id);
    const i = queue.indexOf(id);
    if (i >= 0) queue.splice(i, 1);
    pending.cleanup();
    return pending;
  };
  /** What a request whose reply is lost may still claim. Before it was forwarded nothing reached
   * the wallet. After, a write may have been approved, and other methods report no outcome. */
  const lost = (p: Pending): WriteOutcome | undefined =>
    !p.forwarded ? 'not-submitted' : p.writing ? 'unknown' : undefined;
  /** `forwardedOnly`: keep the requests still queued for the popup's next document. */
  const failAll = (
    code: 'DISCONNECTED' | 'CONTEXT_CHANGED',
    message: string,
    forwardedOnly = false,
  ) => {
    for (const [id, p] of [...outstanding]) {
      if (forwardedOnly && !p.forwarded) continue;
      settle(id);
      p.reject(new QlyphsError(code, message, lost(p)));
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
        p.reject(new QlyphsError('DISCONNECTED', 'Qlyphs Keys closed', lost(p)));
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
    // Events equal reads: without the popup's channel, mintSession answers null.
    setSession(null);
    if (eager) {
      ended = true;
      // The session ends with its popup; the cache survives for the next one.
      setState(disconnected(), false);
    }
  };
  window.addEventListener('pagehide', () => {
    if (popup && !popup.closed) {
      for (const pending of outstanding.values())
        if (pending.forwarded)
          try {
            post({ id: crypto.randomUUID(), method: 'cancelRequest', target: pending.request.id });
          } catch {
            /* The page is leaving; cancellation cannot guarantee a rollback. */
          }
      // The session is bound to the popup, which outlives this page; this is the page's only way to
      // stop it. It arrives once this page is gone, without a source, so the popup accepts it only in
      // exactly this form (connect.ts). Delivery is not guaranteed: closing the popup is the sure stop.
      if (ready && session && live(session))
        try {
          post({ id: crypto.randomUUID(), method: 'stopMintSession', params: { session: session.id } });
        } catch {
          /* best effort */
        }
    }
    // Keep the wallet visible: it may already be submitting a transaction.
    close('Page left the Qlyphs Keys session. Reconnect explicitly to continue.');
    setState(disconnected(), false);
  });
  /** A popup whose document does not announce itself in time is closed, with what waits for it. */
  const expectReady = () => {
    clearTimeout(readyTimer);
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
  const watch = () => {
    clearInterval(poll);
    clearTimeout(readyTimer);
    known = popup ? announcedBy(popup, keys) : undefined;
    ready = known !== undefined;
    poll = setInterval(() => {
      if (!popup || popup.closed) close('Qlyphs Keys was closed');
    }, POLL_MS);
    if (!ready) expectReady();
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
        const id = announcedDocument(data);
        if (id === undefined) return;
        // The same document announced itself again, for a hello from this page. Any other document,
        // or one too old to name itself, replaced the document this provider knew (a reload, even
        // one that sent no leave): what was forwarded there gets no reply, and the session bound to
        // its wallet channel has stopped. Queued requests go to the new document.
        if (id === null || id !== known) {
          failAll(
            'CONTEXT_CHANGED',
            'Qlyphs Keys was reloaded. Review wallet history before retrying.',
            true,
          );
          setSession(null);
        }
        known = id;
        ready = true;
        clearTimeout(readyTimer);
        flush();
      } else if (data.type === 'leave') {
        // The popup document is going away: closed, reloaded or navigated. Its session ends now and
        // new requests wait for its next document. What it held fails when the popup closes or that
        // document announces itself, so a close still reports DISCONNECTED.
        ready = false;
        setSession(null);
        expectReady();
      }
      return;
    }
    if (data.channel !== RESPONSE_CHANNEL) return;
    if (data.reset === true) {
      failAll('CONTEXT_CHANGED', 'Wallet context changed. Review wallet history before retrying.');
      // The wallet channel was replaced; the session bound to the old one has stopped.
      setSession(null);
      return;
    }
    if (data.event === 'mintSessionChanged') {
      // Events equal reads: until the popup document announces itself, mintSession answers null
      // here, and nothing yet tells which document relayed the snapshot.
      if (!ready) return;
      const value = sessionSnapshot(data.session);
      if (value !== undefined) setSession(value);
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
      // A session read changes nothing, so its refusal names no outcome, whatever the reply says:
      // the popup refuses some requests itself, and an older wallet may still name one.
      pending.reject(
        SESSION_READS.has(pending.method) ? new QlyphsError(error.code, error.message) : error,
      );
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
    // The approval reply can arrive before the first event, and a page reloaded under the popup
    // learns of a running session from a read: record it, so that leaving the page can still ask the
    // wallet to stop it and its end is reported.
    if (pending.method === 'requestMintSession' || SESSION_READS.has(pending.method)) {
      const value = sessionSnapshot(data.result);
      if (value && value.id !== session?.id) setSession(value);
    }
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
      let timeout: number;
      try {
        const limit = method === 'connect' ? 600_000 : 135_000;
        timeout = validTimeout(options.timeoutMs, limit, limit);
      } catch (error) {
        return Promise.reject(error);
      }
      if (method === 'capabilities') return Promise.resolve(current());
      if (method === 'state') return Promise.resolve(snapshot);
      if (method === 'accounts') return Promise.resolve(snapshot.accounts);
      if (method === 'network') return Promise.resolve(snapshot.network);
      if (SESSION_READS.has(method!) && !(ready && popup && !popup.closed)) return Promise.resolve(null);
      // Never open a review this keys origin does not offer for its network or in this browser.
      if (method === 'requestMintSession' && !current().mintSessions)
        return Promise.reject(
          new QlyphsError('UNSUPPORTED_METHOD', 'This wallet cannot run mint sessions', 'not-submitted'),
        );
      if (ended)
        return Promise.reject(
          new QlyphsError('DISCONNECTED', 'Qlyphs Keys was closed', 'not-submitted'),
        );
      if (outstanding.size >= 8)
        return Promise.reject(new QlyphsError('BUSY', 'Too many pending requests', 'not-submitted'));
      const id = crypto.randomUUID(),
        writing = WRITES.has(method!);
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
              lost(pending),
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

/** `network`: what the keys origin signs for, until the wallet reports it. Needed for an HTTPS
 * keys origin that is not mainnet when the SDK is compiled from source without the build define. */
export interface KeysProviderOptions {
  origin?: string;
  network?: KeysNetwork;
}

/** Opens Qlyphs Keys now; call it synchronously from a click. Ends on popup close or pagehide.
 * Closing the popup also stops a mint session started through it. */
export function openKeysProvider(options: KeysProviderOptions & { origin: string }): QlyphsProvider {
  return make(origin(options?.origin), true, network(options?.network));
}

/** Opens Qlyphs Keys on the first connect, requestTransaction, requestMintSession or disconnect;
 * reopens when needed. Closing the popup stops a running mint session.
 * Between popups the provider has no channel to the wallet: its state is the last one it saw and
 * may be out of date (another tab disconnected it, the wallet switched network). It is corrected
 * on the next popup: an UNAUTHORIZED answer or a state for another network ends the session with
 * a disconnect event. Pagehide cancels pending requests, including BFCache navigation. After
 * restoration, only a fresh explicit request opens the popup; no old request is replayed. */
export function createKeysProvider(options: KeysProviderOptions = {}): QlyphsProvider {
  return make(origin(options.origin ?? KEYS_ORIGIN), false, network(options.network));
}

/** The extension wins when it is installed. */
export function installKeysProvider(options: KeysProviderOptions = {}): QlyphsProvider | null {
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
