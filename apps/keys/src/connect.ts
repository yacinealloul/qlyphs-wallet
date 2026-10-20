/** The popup a dapp opens. The dapp origin is the browser-supplied MessageEvent.origin, checked exactly. */
import { ALL_DAPPS } from '../../extension/src/config.ts';
import { boot } from './host.ts';
import type { HostPort } from './host.ts';
import type { PublicErrorCode } from '../../../packages/provider/src/index.ts';
import { KEYS_CHANNEL, MAX_MESSAGE, REQUEST_CHANNEL, RESPONSE_CHANNEL } from './protocol.ts';
import type { PopupReady } from './protocol.ts';

const $ = (id: string) => document.getElementById(id)!;
const status = (text: string) => ($('status').textContent = text);
const origin = new URL(location.href).searchParams.get('origin');
const opener = window.opener as Window | null;
const REQUEST_ID = /^[A-Za-z0-9_-]{16,80}$/;

async function start(origin: string, opener: Window) {
  const host = await boot();
  $('site').textContent = new URL(origin).host;
  status('Continue in this window when asked.');
  const post = (value: object) => opener.postMessage({ channel: RESPONSE_CHANNEL, ...value }, origin);
  // Every announcement names this document, so the dapp can tell one it asked to repeat (hello)
  // from a new document after a reload of this window.
  const documentId = crypto.randomUUID();
  const announce = () => {
    const ready: PopupReady = { channel: KEYS_CHANNEL, type: 'ready', documentId };
    opener.postMessage(ready, origin);
  };
  const outstanding = new Set<string>();
  let port: HostPort | null = null,
    bootstrap: string | undefined,
    served = false,
    active = true;
  // The session the current wallet channel runs, as the wallet reports it on that channel (no other
  // channel hears of it), and whether the stop of a dapp page that left was passed on for it.
  let running: { id: string; stopped: boolean } | null = null;
  // Wallet replies that nobody waits for: those to the stops of pages that left.
  const unanswered = new Set<string>();
  const follow = (session: unknown) => {
    const s = session as { id?: unknown; state?: unknown } | null;
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || typeof s.state !== 'string' ||
        s.state === 'ended')
      running = null;
    else if (running?.id !== s.id) running = { id: s.id, stopped: false };
  };
  let setup: {
    id: string;
    close: () => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  const stopSetup = () => {
    const pending = setup;
    setup = null;
    if (!pending) return;
    clearTimeout(pending.timer);
    outstanding.delete(pending.id);
    pending.close();
  };
  const fail = (id: string, code: PublicErrorCode, message: string) => {
    outstanding.delete(id);
    post({ id, error: { code, message, outcome: 'not-submitted' } });
    settle();
  };
  const settle = () => {
    if (!served || outstanding.size || host.overlays()) return;
    setTimeout(() => active && served && !outstanding.size && !host.overlays() && window.close(), 300);
  };
  host.onOverlayChange(settle);
  const ensurePort = () => {
    if (port) return port;
    const p = host.openPort(origin);
    port = p;
    running = null;
    unanswered.clear();
    p.onMessage((value) => {
      if (port !== p || !active || !value || typeof value !== 'object') return;
      const message = value as Record<string, unknown>;
      if (bootstrap !== undefined && message.id === bootstrap) {
        bootstrap = undefined;
        if (message.result) post({ event: 'stateChanged', state: message.result });
        return;
      }
      if (typeof message.id === 'string' && unanswered.delete(message.id)) return;
      if (message.event === 'mintSessionChanged') follow(message.session);
      post(value);
      if (typeof message.id === 'string' && outstanding.delete(message.id)) settle();
    });
    p.onClose(() => {
      if (port !== p) return;
      port = null;
      bootstrap = undefined;
      stopSetup();
      outstanding.clear();
      post({ reset: true });
      settle();
    });
    bootstrap = crypto.randomUUID();
    p.post({ id: bootstrap, method: 'state' });
    return p;
  };
  const connect = (request: { id: string; method: 'connect' }, p: HostPort) => {
    if (setup) {
      fail(request.id, 'BUSY', 'Complete the connection already open in this window.');
      return;
    }
    // Only the trusted wallet UI sees setup state. The dapp receives nothing until the
    // unchanged controller checks its origin and grants access through connection consent.
    const wallet = host.setupWallet();
    const pending = {
      id: request.id,
      close: wallet.close,
      timer: setTimeout(() => {
        if (setup !== pending) return;
        stopSetup();
        fail(request.id, 'TIMEOUT', 'Connection expired. Start a new connection from the site.');
      }, 600_000),
    };
    setup = pending;
    void wallet.ready.then(() => {
      if (setup !== pending) return;
      setup = null;
      clearTimeout(pending.timer);
      if (!active || opener.closed || !topLevel(opener) || port !== p) return;
      status('Review the connection in this window.');
      p.post(request);
    }).catch(() => {
      if (setup !== pending) return;
      stopSetup();
      fail(request.id, 'UNAVAILABLE', 'Wallet setup closed or could not start. Connect again to continue.');
    });
  };
  // A dapp page that leaves posts the stop of its session from pagehide (sdk.ts). Browsers deliver
  // it once that page is gone, without a source: nothing tells which window of the dapp origin sent
  // it, and there is no one to answer. A stop only removes authority, so it is accepted anyway:
  // whoever sent it can only end early the one session this channel runs, as closing this window
  // would, never start, sign or read anything. Only that exact stop is accepted this way, once per
  // session and unanswered, under an id of this window: the wallet drops a channel that repeats an
  // id the opener still waits on.
  const stopLeft = (data: unknown) => {
    const session = running;
    if (!port || !session || session.stopped || !leavingStop(data, session.id)) return;
    session.stopped = true;
    const id = crypto.randomUUID();
    unanswered.add(id);
    port.post({ id, method: 'stopMintSession', params: { session: session.id } });
  };
  window.addEventListener('message', (event) => {
    if (!active || event.origin !== origin || !topLevel(opener)) return;
    if (event.source === null) {
      stopLeft(event.data);
      return;
    }
    if (event.source !== opener) return;
    const data = event.data as { channel?: unknown; type?: unknown; request?: unknown } | null;
    if (!data || typeof data !== 'object') return;
    // A page of the opener that has not seen this document announce itself, such as one reloaded
    // while this window stayed open, asks for the announcement.
    if (data.channel === KEYS_CHANNEL && data.type === 'hello') {
      announce();
      return;
    }
    if (data.channel !== REQUEST_CHANNEL) return;
    const request = data.request as { id?: unknown; method?: unknown; target?: unknown } | null;
    if (!request || typeof request !== 'object') return;
    try {
      if (JSON.stringify(request).length > MAX_MESSAGE) return;
      if (request.method === 'cancelRequest' && !port) return;
      // A repeated ID must not leave an untracked connect queued behind onboarding.
      if (typeof request.id === 'string' && outstanding.has(request.id)) {
        stopSetup();
        const p = port;
        port = null;
        bootstrap = undefined;
        p?.close();
        outstanding.clear();
        post({ reset: true });
        settle();
        return;
      }
      if (request.method === 'cancelRequest' && request.target === setup?.id) stopSetup();
      if (request.method === 'disconnect' && setup) {
        const id = setup.id;
        stopSetup();
        fail(id, 'ABORTED', 'Connection cancelled.');
      }
      if (typeof request.id === 'string' && request.method !== 'cancelRequest') {
        if (outstanding.size >= 8) {
          fail(request.id, 'BUSY', 'Too many pending requests.');
          return;
        }
        outstanding.add(request.id);
        served = true;
      }
      const p = ensurePort();
      if (request.method === 'connect' && typeof request.id === 'string' &&
          REQUEST_ID.test(request.id) && Object.keys(request).length === 2) {
        connect({ id: request.id, method: 'connect' }, p);
      } else {
        p.post(request);
      }
    } catch {
      post({ reset: true });
    }
  });
  const leave = () => {
    if (!active) return;
    active = false;
    stopSetup();
    const p = port;
    port = null;
    p?.close();
    // Closing the port locally sends no reset, and the dapp cannot tell a reload from a close. Say
    // that this document answers nothing more: its session ended, and new requests must wait for
    // the next document instead of reaching this one.
    if (!opener.closed) opener.postMessage({ channel: KEYS_CHANNEL, type: 'leave' }, origin);
  };
  window.addEventListener('pagehide', leave);
  setInterval(() => {
    if (!opener.closed) return;
    leave();
    window.close();
  }, 400);
  announce();
}

/** A plain object with exactly the fields `names`. */
function exact(value: unknown, names: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
}

/** Whether `data` is exactly what the SDK posts to stop `session` as its page leaves, within the
 * message limit. */
function leavingStop(data: unknown, session: string): boolean {
  if (!exact(data, ['channel', 'request']) || data.channel !== REQUEST_CHANNEL) return false;
  const request = data.request;
  return exact(request, ['id', 'method', 'params']) && request.method === 'stopMintSession' &&
    typeof request.id === 'string' && REQUEST_ID.test(request.id) &&
    exact(request.params, ['session']) && request.params.session === session &&
    JSON.stringify(request).length <= MAX_MESSAGE;
}

// Like the extension's frameId === 0 rule: a dapp framed by another page may not connect.
function topLevel(w: Window) {
  try {
    return w.top === w;
  } catch {
    return false;
  }
}

if (origin && ALL_DAPPS.includes(origin) && opener && !opener.closed && topLevel(opener))
  start(origin, opener).catch((e: unknown) =>
    status(e instanceof Error ? e.message : 'Qlyphs Keys could not start.'),
  );
else status('Open Qlyphs Keys from a Qlyphs app.');
