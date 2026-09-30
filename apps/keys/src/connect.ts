/** The popup a dapp opens. The dapp origin is the browser-supplied MessageEvent.origin, checked exactly. */
import { ALL_DAPPS } from '../../extension/src/config.ts';
import { boot } from './host.ts';
import type { HostPort } from './host.ts';
import type { PublicErrorCode } from '../../../packages/provider/src/index.ts';
import { KEYS_CHANNEL, MAX_MESSAGE, REQUEST_CHANNEL, RESPONSE_CHANNEL } from './protocol.ts';

const $ = (id: string) => document.getElementById(id)!;
const status = (text: string) => ($('status').textContent = text);
const origin = new URL(location.href).searchParams.get('origin');
const opener = window.opener as Window | null;

async function start(origin: string, opener: Window) {
  const host = await boot();
  $('site').textContent = new URL(origin).host;
  status('Continue in this window when asked.');
  const post = (value: object) => opener.postMessage({ channel: RESPONSE_CHANNEL, ...value }, origin);
  const outstanding = new Set<string>();
  let port: HostPort | null = null,
    bootstrap: string | undefined,
    served = false,
    active = true;
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
    p.onMessage((value) => {
      if (port !== p || !active || !value || typeof value !== 'object') return;
      const message = value as { id?: unknown; result?: unknown };
      if (bootstrap !== undefined && message.id === bootstrap) {
        bootstrap = undefined;
        if (message.result) post({ event: 'stateChanged', state: message.result });
        return;
      }
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
  window.addEventListener('message', (event) => {
    if (!active || event.source !== opener || event.origin !== origin || !topLevel(opener)) return;
    const data = event.data as { channel?: unknown; request?: unknown } | null;
    if (!data || typeof data !== 'object' || data.channel !== REQUEST_CHANNEL) return;
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
          /^[A-Za-z0-9_-]{16,80}$/.test(request.id) && Object.keys(request).length === 2) {
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
  };
  window.addEventListener('pagehide', leave);
  setInterval(() => {
    if (!opener.closed) return;
    leave();
    window.close();
  }, 400);
  opener.postMessage({ channel: KEYS_CHANNEL, type: 'ready' }, origin);
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
