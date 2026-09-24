/** Worker-side ExtensionAPI. The hub stands in for Chrome: it binds every sender to
 * the keys page or dapp port that really sent it, and never accepts a page-chosen URL
 * for a confirmation. Any compiled network's dapp origin may open a port; background.ts answers
 * only the active network's. */
import type { ExtensionAPI, Port, Sender } from '../../extension/src/browser.ts';
import { ALL_DAPPS } from '../../extension/src/config.ts';
import { get, set } from './storage.ts';
import { RUNTIME_ID } from './hub.ts';
import type { DocToHub, HostToHub, HubToDoc, HubToHost } from './hub.ts';

type Fn = (...args: any[]) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
function event<T extends Fn>() {
  const listeners = new Set<T>();
  return {
    listeners,
    addListener: (f: T) => void listeners.add(f),
    fire(...args: Parameters<T>) {
      for (const f of listeners)
        try {
          f(...args);
        } catch {
          /* one listener cannot break the others */
        }
    },
  };
}
const scope = self as unknown as {
  location: Location;
  onconnect: ((e: MessageEvent) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
};
const ORIGIN = scope.location.origin;
const MAX_CALL = 65536;
const clone = (v: unknown): unknown => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

interface Host {
  id: string;
  port: MessagePort;
  sender: Sender;
  tabId: number;
  windowId: number;
  overlays: Set<number>;
  ports: Set<number>;
  seen: number;
}
interface DappPort {
  port: Port;
  tabId: number;
  message: ReturnType<typeof event<(m: unknown) => void>>;
  disconnect: ReturnType<typeof event<() => void>>;
}
/** The wallet is served at a clean `/`, but the shared background checks senders against the
 * extension's page name: `/ui.html?surface=tab` for the wallet tab, `/ui.html?request=<id>` for a
 * confirmation. Pages report their real address; the hub names them for the background here, once.
 * Any other page (`/connect`) keeps its address and so gets no wallet-page rights. */
function extensionPageURL(url: string): string {
  const u = new URL(url);
  if (u.origin !== ORIGIN || u.pathname !== '/') return u.href;
  const request = u.searchParams.get('request');
  u.pathname = '/ui.html';
  u.search = request === null ? '?surface=tab' : '?request=' + encodeURIComponent(request);
  return u.href;
}
const hosts = new Map<string, Host>();
const docs = new Map<MessagePort, { sender: Sender; windowId: number }>();
const dappPorts = new Map<string, DappPort>();
const creating = new Map<
  number,
  { host: Host; url: string; ok: (w: { id: number }) => void; no: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>();
// Hosts with an in-flight call that may open a confirmation, oldest first. Keys-page
// transacts win over dapp requests, so a dapp popup can never receive the user's own
// confirmation just by sending a message while that transact is being prepared.
const claims: { host: string; key: string; page: boolean }[] = [];
let seen = 0;
let claimSeq = 0;
let nextId = 1;

const onMessage = event<Parameters<ExtensionAPI['runtime']['onMessage']['addListener']>[0]>();
const onConnect = event<(port: Port) => void>();
const tabRemoved = event<(id: number) => void>();
const windowRemoved = event<(id: number) => void>();
const alarm = event<() => void>();
const alarms = new Map<string, ReturnType<typeof setInterval>>();
const dappKey = (host: Host, portId: number) => host.id + ':' + portId;
const unclaim = (match: (c: (typeof claims)[number]) => boolean) => {
  for (let i = claims.length; i--; ) if (match(claims[i]!)) claims.splice(i, 1);
};

function dispatch(message: unknown, sender: Sender, reply: (value: unknown) => void) {
  let copy: unknown;
  try {
    const json = JSON.stringify(message);
    if (json === undefined || json.length > MAX_CALL) throw Error();
    copy = JSON.parse(json);
  } catch {
    reply({ error: 'Invalid channel' });
    return;
  }
  let answered = false,
    waiting = false;
  const respond = (value: unknown) => {
    if (answered) return;
    answered = true;
    reply(clone(value));
  };
  for (const f of onMessage.listeners)
    try {
      if (f(copy, { ...sender, tab: { ...sender.tab } }, respond) === true) waiting = true;
    } catch {
      /* listener errors are not replies */
    }
  if (!waiting) respond(undefined);
}
function live(): Host | undefined {
  for (const page of [true, false])
    for (const c of claims) if (c.page === page && hosts.has(c.host)) return hosts.get(c.host);
  let best: Host | undefined;
  for (const h of hosts.values()) if (!best || h.seen > best.seen) best = h;
  return best;
}
function closeWindow(host: Host, windowId: number) {
  if (!host.overlays.delete(windowId)) return;
  for (const [port, d] of docs)
    if (d.windowId === windowId) {
      docs.delete(port);
      port.close();
    }
  windowRemoved.fire(windowId);
}
function dropDapp(key: string, fire: boolean) {
  const d = dappPorts.get(key);
  if (!d) return;
  dappPorts.delete(key);
  unclaim((c) => c.key.startsWith(key + '#'));
  if (fire) {
    d.disconnect.fire();
    tabRemoved.fire(d.tabId);
  }
}
function gone(id: string) {
  const host = hosts.get(id);
  if (!host) return;
  hosts.delete(id);
  unclaim((c) => c.host === id);
  for (const [w, c] of creating)
    if (c.host === host) {
      clearTimeout(c.timer);
      creating.delete(w);
      c.no(Error('Confirmation window could not be opened'));
    }
  for (const w of [...host.overlays]) closeWindow(host, w);
  for (const p of host.ports) dropDapp(dappKey(host, p), true);
  tabRemoved.fire(host.tabId);
  try {
    host.port.close();
  } catch {
    /* already closed */
  }
}
function attachDoc(port: MessagePort, sender: Sender, windowId: number) {
  docs.set(port, { sender, windowId });
  port.onmessage = (e: MessageEvent) => {
    const m = e.data as DocToHub;
    if (!docs.has(port) || !m || m.type !== 'call' || !Number.isSafeInteger(m.callId)) return;
    dispatch(m.message, sender, (value) =>
      port.postMessage({ type: 'reply', callId: m.callId, value } satisfies HubToDoc),
    );
  };
  port.start();
}
function openDapp(host: Host, portId: number, origin: string) {
  if (!Number.isSafeInteger(portId) || typeof origin !== 'string' || !ALL_DAPPS.includes(origin)) {
    host.port.postMessage({ type: 'port-close', portId } satisfies HubToHost);
    return;
  }
  const key = dappKey(host, portId);
  if (dappPorts.has(key)) return;
  const tabId = nextId++;
  const message = event<(m: unknown) => void>(),
    disconnect = event<() => void>();
  const port: Port = {
    name: 'qlyphs-v1',
    sender: {
      id: RUNTIME_ID,
      url: origin + '/',
      origin,
      frameId: 0,
      tab: { id: tabId },
      documentId: crypto.randomUUID(),
    },
    postMessage(value) {
      if (dappPorts.get(key)?.port !== port) return;
      const id = (value as { id?: unknown } | null)?.id;
      if (typeof id === 'string') unclaim((c) => c.key === key + '#' + id);
      host.port.postMessage({ type: 'port-message', portId, message: clone(value) } satisfies HubToHost);
    },
    disconnect() {
      if (dappPorts.get(key)?.port !== port) return;
      // Like Chrome: the side that disconnects does not get its own onDisconnect.
      dropDapp(key, false);
      host.ports.delete(portId);
      host.port.postMessage({ type: 'port-close', portId } satisfies HubToHost);
    },
    onMessage: message,
    onDisconnect: disconnect,
  };
  dappPorts.set(key, { port, tabId, message, disconnect });
  host.ports.add(portId);
  onConnect.fire(port);
}
function accept(port: MessagePort | undefined) {
  if (!port) return;
  let host: Host | undefined;
  port.onmessage = (e: MessageEvent) => {
    const m = e.data as HostToHub;
    if (!m || typeof m !== 'object') return;
    if (!host) {
      if (m.type !== 'hello') return;
      try {
        if (
          typeof m.hostId !== 'string' || hosts.has(m.hostId) ||
          typeof m.lock !== 'string' || !m.lock.startsWith('qlyphs-keys-host:') ||
          typeof m.documentId !== 'string' || new URL(m.url).origin !== ORIGIN
        )
          throw Error();
      } catch {
        port.close();
        return;
      }
      const tabId = nextId++,
        windowId = nextId++,
        id = m.hostId;
      host = {
        id,
        port,
        tabId,
        windowId,
        overlays: new Set(),
        ports: new Set(),
        seen: ++seen,
        sender: { id: RUNTIME_ID, url: extensionPageURL(m.url), origin: ORIGIN, frameId: 0, documentId: m.documentId, tab: { id: tabId, windowId } },
      };
      hosts.set(id, host);
      port.postMessage({ type: 'welcome', tabId, windowId } satisfies HubToHost);
      // Granted only once the page holding it has gone, however it went.
      void navigator.locks.request(m.lock, () => gone(id));
      return;
    }
    const h = host;
    if (!hosts.has(h.id)) return;
    switch (m.type) {
      case 'focus':
        h.seen = ++seen;
        return;
      case 'call': {
        if (!Number.isSafeInteger(m.callId)) return;
        let key: string | undefined;
        if ((m.message as { action?: unknown } | null)?.action === 'transact')
          claims.push({ host: h.id, key: (key = 'call:' + ++claimSeq), page: true });
        dispatch(m.message, h.sender, (value) => {
          if (key) unclaim((c) => c.key === key);
          port.postMessage({ type: 'reply', callId: m.callId, value } satisfies HubToHost);
        });
        return;
      }
      case 'attach': {
        const c = creating.get(m.windowId),
          doc = e.ports[0];
        if (!doc) return;
        if (!c || c.host !== h || typeof m.documentId !== 'string') {
          doc.close();
          if (!h.overlays.has(m.windowId))
            port.postMessage({ type: 'remove', windowId: m.windowId } satisfies HubToHost);
          return;
        }
        creating.delete(m.windowId);
        clearTimeout(c.timer);
        h.overlays.add(m.windowId);
        attachDoc(
          doc,
          { id: RUNTIME_ID, url: extensionPageURL(c.url), origin: ORIGIN, frameId: 0, documentId: m.documentId, tab: { id: h.tabId, windowId: m.windowId } },
          m.windowId,
        );
        c.ok({ id: m.windowId });
        return;
      }
      case 'closed': {
        const c = creating.get(m.windowId);
        if (c?.host === h) {
          creating.delete(m.windowId);
          clearTimeout(c.timer);
          c.no(Error('Confirmation window could not be opened'));
        }
        closeWindow(h, m.windowId);
        return;
      }
      case 'port-open':
        openDapp(h, m.portId, m.origin);
        return;
      case 'port-message': {
        const d = dappPorts.get(dappKey(h, m.portId));
        if (!d) return;
        // disconnect never opens a window, so it claims nothing.
        const { method, id } = (m.message ?? {}) as { method?: unknown; id?: unknown };
        if ((method === 'connect' || method === 'requestTransaction') && typeof id === 'string' && claims.length < 256)
          claims.push({ host: h.id, key: dappKey(h, m.portId) + '#' + id, page: false });
        let copy: unknown;
        try {
          copy = clone(m.message);
        } catch {
          return;
        }
        setTimeout(() => {
          if (dappPorts.get(dappKey(h, m.portId)) === d) d.message.fire(copy);
        }, 0);
        return;
      }
      case 'port-close':
        h.ports.delete(m.portId);
        dropDapp(dappKey(h, m.portId), true);
        return;
      case 'bye':
        gone(h.id);
        return;
    }
  };
  port.start();
}
scope.onconnect = (e) => accept(e.ports[0]);
scope.onmessage = (e) => {
  if ((e.data as { type?: unknown } | null)?.type === 'keys:connect') accept(e.ports[0]);
};

export const browser: ExtensionAPI = {
  runtime: {
    id: RUNTIME_ID,
    getURL: (path) => new URL(path.replace(/^\/?ui\.html/, ''), ORIGIN + '/').href,
    sendMessage: () => Promise.reject(Error('Not available in the wallet worker')),
    connect() {
      throw Error('Not available in the wallet worker');
    },
    onConnect,
    onMessage,
    onInstalled: { addListener() {} },
  },
  storage: { local: { get, set } },
  tabs: {
    // Only reached from install and notification clicks, which the web never fires.
    create: async () => ({}),
    async get(id) {
      for (const h of hosts.values()) if (h.tabId === id) return { id, windowId: h.windowId, url: h.sender.url };
      for (const d of dappPorts.values()) if (d.tabId === id) return { id };
      throw Error('No tab with id: ' + id);
    },
    onUpdated: { addListener() {} },
    onRemoved: tabRemoved,
  },
  windows: {
    create({ url }) {
      return new Promise((ok, no) => {
        const u = new URL(url);
        const host = live();
        if (u.origin !== ORIGIN || u.pathname !== '/' || !host)
          return no(Error('Confirmation window could not be opened'));
        const windowId = nextId++;
        const timer = setTimeout(() => {
          if (!creating.delete(windowId)) return;
          host.port.postMessage({ type: 'remove', windowId } satisfies HubToHost);
          no(Error('Confirmation window could not be opened'));
        }, 10000);
        creating.set(windowId, { host, url: u.href, ok, no, timer });
        host.port.postMessage({ type: 'open', windowId, url: u.href } satisfies HubToHost);
      });
    },
    async remove(id) {
      for (const h of hosts.values())
        if (h.overlays.has(id) || [...creating].some(([w, c]) => w === id && c.host === h))
          h.port.postMessage({ type: 'remove', windowId: id } satisfies HubToHost);
    },
    onRemoved: windowRemoved,
  },
  alarms: {
    create(name, { periodInMinutes }) {
      if (alarms.has(name)) return;
      alarms.set(name, setInterval(() => alarm.fire(), periodInMinutes * 60000));
    },
    onAlarm: alarm,
  },
};
