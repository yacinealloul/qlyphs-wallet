/** Page-side ExtensionAPI seen by ui.ts: every wallet call goes to the shared background worker. */
import type { ExtensionAPI } from '../../extension/src/browser.ts';
import { boot } from './host.ts';
import type { Host } from './host.ts';
import type { DocToHub, HubToDoc } from './hub.ts';
import { RUNTIME_ID } from './hub.ts';
import { KEYS_CHANNEL } from './protocol.ts';
import { get } from './storage.ts';

const framed = window.top !== window;
let host: Promise<Host> | undefined;
// Inside a confirmation overlay, calls wait for the port the host page hands over.
let doc: MessagePort | null = null;
const queued: DocToHub[] = [];
const waiting = new Map<number, (v: unknown) => void>();
let nextCall = 1;
if (framed)
  window.addEventListener('message', (event) => {
    const data = event.data as { channel?: unknown; type?: unknown } | null;
    if (doc || event.source !== parent || event.origin !== location.origin ||
        data?.channel !== KEYS_CHANNEL || data.type !== 'port' || !event.ports[0]) return;
    const port = event.ports[0];
    doc = port;
    port.onmessage = (e: MessageEvent) => {
      const m = e.data as HubToDoc;
      if (m?.type !== 'reply') return;
      waiting.get(m.callId)?.(m.value);
      waiting.delete(m.callId);
    };
    for (const m of queued.splice(0)) port.postMessage(m);
  });
function sendMessage(value: unknown): Promise<unknown> {
  const message = JSON.parse(JSON.stringify(value)) as unknown;
  if (!framed) return (host ??= boot()).then((h) => h.call(message));
  return new Promise((resolve) => {
    const m: DocToHub = { type: 'call', callId: nextCall++, message };
    waiting.set(m.callId, resolve);
    if (doc) doc.postMessage(m);
    else queued.push(m);
  });
}
const noop = { addListener() {} };
export const browser: ExtensionAPI = {
  runtime: {
    id: RUNTIME_ID,
    getURL: (p) => new URL(p.replace(/^\/?ui\.html/, ''), location.origin + '/').href,
    sendMessage,
    connect: () => {
      throw Error('Unsupported');
    },
    onConnect: noop,
    onMessage: noop,
    onInstalled: noop,
  },
  storage: {
    local: {
      // Read-only: a switchable build learns the network the worker stored. Writes stay in the worker.
      get,
      set: () => Promise.reject(Error('Unsupported')),
    },
  },
  tabs: {
    create: ({ url }) => {
      window.open(url, '_blank', 'noopener,noreferrer');
      return Promise.resolve({});
    },
    get: () => Promise.reject(Error('Unsupported')),
    onUpdated: noop,
    onRemoved: noop,
  },
  windows: {
    create: () => Promise.reject(Error('Unsupported')),
    remove: () => Promise.resolve(),
    onRemoved: noop,
  },
  alarms: { create() {}, onAlarm: noop },
};
