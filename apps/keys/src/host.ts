/** A top-level keys page: keeps the wallet worker alive and shows its confirmations. */
import { KEYS_CHANNEL } from './protocol.ts';
import type { HostToHub, HubToHost } from './hub.ts';

export interface HostPort {
  post(message: unknown): void;
  close(): void;
  onMessage(fn: (message: unknown) => void): void;
  onClose(fn: () => void): void;
}
export type KeysPort = HostPort;
export interface Host {
  call(message: unknown): Promise<unknown>;
  overlays(): number;
  onOverlayChange(fn: () => void): void;
  openPort(origin: string): HostPort;
}
/** Replaces the page with a single sentence; used when keys cannot start here. */
export function fatal(text: string): void {
  const p = document.createElement('p');
  p.className = 'keys-fatal';
  p.textContent = text;
  document.body.replaceChildren(p);
}
const hold = (name: string, options: LockOptions = {}) =>
  new Promise<boolean>((granted) => {
    void navigator.locks.request(name, options, (lock) => {
      granted(!!lock);
      return lock ? new Promise<never>(() => {}) : undefined;
    });
  });

function outdated() {
  const notice = document.createElement('div');
  notice.className = 'keys-outdated';
  notice.setAttribute('role', 'alert');
  const title = document.createElement('h1');
  title.textContent = 'Qlyphs Keys was updated';
  const text = document.createElement('p');
  text.textContent =
    'Another Qlyphs Keys tab or window is still running the previous version. Close every other Qlyphs Keys tab and window, then reload this page. Your wallet stays saved on this device.';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => location.reload());
  notice.append(title, text, reload);
  document.body.append(notice);
  reload.focus();
}

export async function boot(): Promise<Host> {
  if (window.top !== window) throw Error('Qlyphs Keys cannot run inside another page.');
  if (!navigator.locks) throw Error('This browser is not supported.');
  const hostId = crypto.randomUUID(),
    lock = 'qlyphs-keys-host:' + hostId;
  await hold(lock);
  const script = new URL('background.js', location.origin + '/').href;
  let port: MessagePort;
  if (typeof SharedWorker !== 'undefined') {
    port = new SharedWorker(script, { type: 'module', name: 'qlyphs-keys' }).port;
  } else {
    // Without SharedWorker only one page may own the wallet worker at a time.
    if (!(await hold('qlyphs-keys-background', { ifAvailable: true })))
      throw Error('Qlyphs Keys is open in another window. Close it to continue.');
    const worker = new Worker(script, { type: 'module', name: 'qlyphs-keys' });
    const ch = new MessageChannel();
    worker.postMessage({ type: 'keys:connect' }, [ch.port2]);
    port = ch.port1;
  }
  const send = (m: HostToHub, transfer: Transferable[] = []) => port.postMessage(m, transfer);
  const calls = new Map<number, (value: unknown) => void>();
  const frames = new Map<number, HTMLIFrameElement>();
  const overlayListeners = new Set<() => void>();
  const ports = new Map<number, { message: Set<(m: unknown) => void>; close: Set<() => void> }>();
  let callId = 0,
    portId = 0;
  const overlayChanged = () => {
    for (const f of overlayListeners) f();
  };
  const removeFrame = (windowId: number) => {
    const f = frames.get(windowId);
    if (f) {
      frames.delete(windowId);
      f.remove();
      overlayChanged();
    }
    send({ type: 'closed', windowId });
  };
  const open = (windowId: number, url: string) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return send({ type: 'closed', windowId });
    }
    if (u.origin !== location.origin || u.pathname !== '/' || frames.has(windowId))
      return send({ type: 'closed', windowId });
    const f = document.createElement('iframe');
    f.className = 'keys-overlay';
    f.src = u.href;
    f.title = 'Confirm';
    const ch = new MessageChannel();
    frames.set(windowId, f);
    f.addEventListener(
      'load',
      () => {
        f.contentWindow?.postMessage({ channel: KEYS_CHANNEL, type: 'port' }, location.origin, [ch.port2]);
        f.focus();
      },
      { once: true },
    );
    document.body.append(f);
    send({ type: 'attach', windowId, documentId: crypto.randomUUID() }, [ch.port1]);
    overlayChanged();
  };
  const welcome = new Promise<unknown>((ready) => {
    port.onmessage = (e: MessageEvent) => {
      const m = e.data as HubToHost;
      if (!m || typeof m !== 'object') return;
      switch (m.type) {
        case 'welcome':
          ready(m.version);
          return;
        case 'reply':
          calls.get(m.callId)?.(m.value);
          calls.delete(m.callId);
          return;
        case 'open':
          open(m.windowId, m.url);
          return;
        case 'remove':
          removeFrame(m.windowId);
          return;
        case 'port-message':
          for (const f of ports.get(m.portId)?.message ?? []) f(m.message);
          return;
        case 'port-close': {
          const p = ports.get(m.portId);
          ports.delete(m.portId);
          for (const f of p?.close ?? []) f();
          return;
        }
      }
    };
  });
  port.start();
  send({ type: 'hello', hostId, lock, url: location.href, documentId: crypto.randomUUID() });
  // The wallet worker is shared by every keys page and lives until the last one closes, so after a
  // release an open tab can keep an older worker running. Talking to it would fail on every call;
  // say what to do instead. Never stop the older worker from here: it may be mid-submission.
  if ((await welcome) !== QLYPHS_VERSION) {
    outdated();
    throw Error('Qlyphs Keys was updated; close its other tabs and windows');
  }
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
    const { channel, type } = event.data as { channel?: unknown; type?: unknown };
    if (channel !== KEYS_CHANNEL || type !== 'close') return;
    for (const [windowId, f] of frames)
      if (event.source === f.contentWindow) return removeFrame(windowId);
  });
  const focus = () => send({ type: 'focus' });
  window.addEventListener('focus', focus);
  window.addEventListener('pointerdown', focus, true);
  window.addEventListener('pagehide', () => send({ type: 'bye' }));
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });
  return {
    call: (message) =>
      new Promise((resolve) => {
        const id = ++callId;
        calls.set(id, resolve);
        send({ type: 'call', callId: id, message });
      }),
    overlays: () => frames.size,
    onOverlayChange: (fn) => void overlayListeners.add(fn),
    openPort(origin) {
      const id = ++portId,
        p = { message: new Set<(m: unknown) => void>(), close: new Set<() => void>() };
      ports.set(id, p);
      send({ type: 'port-open', portId: id, origin });
      return {
        post: (message) => {
          if (ports.get(id) === p) send({ type: 'port-message', portId: id, message });
        },
        close: () => {
          if (ports.get(id) !== p) return;
          ports.delete(id);
          send({ type: 'port-close', portId: id });
        },
        onMessage: (fn) => void p.message.add(fn),
        onClose: (fn) => void p.close.add(fn),
      };
    },
  };
}
