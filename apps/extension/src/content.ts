import { browser } from './browser.ts';
import type { Port } from './browser.ts';
import { ALL_DAPPS } from './config.ts';
/** ISOLATED world relay. Origin, document and tab come from the browser, never the page. */
// Any origin of a compiled network; the background answers only the active network's origins.
if (window.top === window && ALL_DAPPS.includes(location.origin)) {
  const origin = location.origin;
  let port: Port | null = null,
    active = true,
    recoveryAllowed = true;
  let recovery: ReturnType<typeof setTimeout> | undefined;
  let bootstrap: string | undefined;
  const post = (value: object) =>
    window.postMessage({ channel: 'qlyphs:response:1', ...value }, origin);
  const readState = (p: Port) => {
    bootstrap = crypto.randomUUID();
    p.postMessage({ id: bootstrap, method: 'state' });
  };
  const connect = () => {
    if (port) return port;
    const p = browser.runtime.connect({ name: 'qlyphs-v1' });
    port = p;
    p.onMessage.addListener((value) => {
      if (port !== p || !active || !value || typeof value !== 'object') return;
      const message = value as { id?: string; result?: unknown; error?: unknown };
      if (bootstrap !== undefined && message.id === bootstrap) {
        bootstrap = undefined;
        if (message.result) post({ event: 'stateChanged', state: message.result });
      } else post(value);
    });
    p.onDisconnect.addListener(() => {
      if (port !== p) return;
      port = null;
      bootstrap = undefined;
      post({ reset: true });
      // One read-only recovery, not an endless service-worker keepalive loop.
      if (active && recoveryAllowed) {
        recoveryAllowed = false;
        recovery = setTimeout(() => {
          recovery = undefined;
          if (active && !port)
            try {
              connect();
            } catch {
              /* next explicit read can restore */
            }
        }, 250);
      }
    });
    readState(p);
    return p;
  };
  const restore = () => {
    if (!active) return;
    recoveryAllowed = true;
    try {
      const existing = port;
      const p = connect();
      if (existing) readState(p);
    } catch {
      post({ reset: true });
    }
  };
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== origin || !event.data) return;
    if (event.data.channel === 'qlyphs:hello:2') {
      restore();
      return;
    }
    if (event.data.channel !== 'qlyphs:request:1' || !active) return;
    try {
      const value = event.data.request;
      if (!value || typeof value !== 'object' || JSON.stringify(value).length > 8192) return;
      if (value.method === 'cancelRequest' && !port) return;
      recoveryAllowed = true;
      connect().postMessage(value);
    } catch {
      post({ reset: true });
    }
  });
  window.addEventListener('pagehide', () => {
    active = false;
    clearTimeout(recovery);
    recovery = undefined;
    const p = port;
    port = null;
    bootstrap = undefined;
    p?.disconnect();
  });
  window.addEventListener('pageshow', () => {
    active = true;
    restore();
  });
  window.addEventListener('focus', restore);
  // Injection order between MAIN and ISOLATED scripts is deliberately not assumed.
  restore();
}
