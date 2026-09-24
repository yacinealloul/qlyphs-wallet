import { DAPPS } from './config.ts';
import {
  CAPABILITIES,
  QlyphsError,
  publicError,
  validTimeout,
} from '../../../packages/provider/src/index.ts';
import type {
  ProviderState,
  QlyphsProvider,
  RequestOptions,
  WalletEvent,
  WalletEventMap,
} from '../../../packages/provider/src/index.ts';
/** Untrusted MAIN world. This bridge cannot authenticate itself to same-page scripts.
 * Only the browser-owned controller can grant access or approve a signature. */
if (window.top === window && DAPPS.includes(location.origin) && !Object.hasOwn(window, 'qlyphs')) {
  type Pending = {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    cleanup: () => void;
    writing: boolean;
  };
  const outstanding = new Map<string, Pending>();
  const listeners = new Map<WalletEvent, Set<(value: never) => void>>();
  let snapshot: ProviderState = Object.freeze({
    accounts: Object.freeze([]),
    network: null,
    connected: false,
  });
  const emit = <E extends WalletEvent>(event: E, value: WalletEventMap[E]) => {
    for (const listener of [...(listeners.get(event) ?? [])]) {
      try {
        listener(value as never);
      } catch {
        /* a dapp callback cannot break other subscriptions */
      }
    }
  };
  const freeze = <T>(value: T): T => {
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) freeze(item);
      Object.freeze(value);
    }
    return value;
  };
  const state = (value: ProviderState) => {
    // Data here remains public/untrusted; the SDK validates its consumed DTOs too.
    if (!value || !Array.isArray(value.accounts) || typeof value.connected !== 'boolean') return;
    const next = freeze(structuredClone(value));
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
    const old = snapshot;
    snapshot = next;
    emit('stateChanged', next);
    if (JSON.stringify(old.accounts) !== JSON.stringify(next.accounts))
      emit('accountsChanged', next.accounts);
    if (JSON.stringify(old.network) !== JSON.stringify(next.network))
      emit('networkChanged', next.network);
    if (old.connected && !next.connected) emit('disconnect', { code: 'CONTEXT_CHANGED' });
  };
  const reset = () => {
    for (const pending of outstanding.values()) {
      pending.cleanup();
      pending.reject(
        new QlyphsError(
          'CONTEXT_CHANGED',
          'Wallet context changed. Review wallet history before retrying.',
          pending.writing ? 'unknown' : undefined,
        ),
      );
    }
    outstanding.clear();
    state({ accounts: [], network: null, connected: false });
  };
  const cancel = (target: string) =>
    window.postMessage(
      {
        channel: 'qlyphs:request:1',
        request: { id: crypto.randomUUID(), method: 'cancelRequest', target },
      },
      location.origin,
    );
  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      !event.data ||
      event.data.channel !== 'qlyphs:response:1'
    )
      return;
    const message = event.data;
    if (message.reset) {
      reset();
      return;
    }
    if (message.event === 'stateChanged') {
      state(message.state);
      return;
    }
    const pending = outstanding.get(message.id);
    if (!pending) return;
    outstanding.delete(message.id);
    pending.cleanup();
    if (message.error)
      pending.reject(
        publicError(message.error, 'VERIFICATION_FAILED', pending.writing ? 'unknown' : undefined),
      );
    else pending.resolve(message.result);
  });
  const provider: QlyphsProvider = Object.freeze({
    version: 1 as const,
    protocolVersion: 2 as const,
    request(
      input: { method: string; params?: unknown },
      options: RequestOptions = {},
    ): Promise<unknown> {
      return new Promise((resolve, reject) => {
        if (
          !input ||
          typeof input !== 'object' ||
          !CAPABILITIES.methods.includes(input.method as never)
        ) {
          reject(
            new QlyphsError('UNSUPPORTED_METHOD', 'Unsupported wallet method', 'not-submitted'),
          );
          return;
        }
        if (options.signal?.aborted) {
          reject(new QlyphsError('ABORTED', 'Request aborted before dispatch', 'not-submitted'));
          return;
        }
        if (outstanding.size >= 8) {
          reject(new QlyphsError('BUSY', 'Too many pending requests', 'not-submitted'));
          return;
        }
        const timeout = validTimeout(options.timeoutMs, 135_000);
        const id = crypto.randomUUID(),
          writing = input.method === 'requestTransaction';
        const request = {
          id,
          method: input.method,
          ...(input.params === undefined ? {} : { params: input.params }),
        };
        try {
          if (JSON.stringify(request).length > 8192) throw Error();
        } catch {
          reject(new QlyphsError('INVALID_REQUEST', 'Invalid request', 'not-submitted'));
          return;
        }
        const stop = (code: 'TIMEOUT' | 'ABORTED') => {
          const pending = outstanding.get(id);
          if (!pending) return;
          outstanding.delete(id);
          pending.cleanup();
          try {
            cancel(id);
          } catch {
            /* cancellation is best effort, never a rollback */
          }
          reject(
            new QlyphsError(
              code,
              'Request stopped. Check wallet history; do not automatically repeat a payment.',
              writing ? 'unknown' : undefined,
            ),
          );
        };
        const abort = () => stop('ABORTED');
        const timer = setTimeout(() => stop('TIMEOUT'), timeout);
        const cleanup = () => {
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', abort);
        };
        outstanding.set(id, { resolve, reject, cleanup, writing });
        options.signal?.addEventListener('abort', abort, { once: true });
        // Recheck after listener attachment; no operation is replayed on reconnection.
        if (options.signal?.aborted) {
          stop('ABORTED');
          return;
        }
        try {
          window.postMessage({ channel: 'qlyphs:request:1', request }, location.origin);
        } catch {
          outstanding.delete(id);
          cleanup();
          reject(
            new QlyphsError('INVALID_REQUEST', 'Request could not be dispatched', 'not-submitted'),
          );
        }
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
  Object.defineProperty(window, 'qlyphs', {
    value: provider,
    writable: false,
    configurable: false,
  });
  window.addEventListener('pagehide', reset);
  window.addEventListener('pageshow', () =>
    window.postMessage({ channel: 'qlyphs:hello:2' }, location.origin),
  );
  window.postMessage({ channel: 'qlyphs:hello:2' }, location.origin);
  window.dispatchEvent(new Event('qlyphs:initialized'));
}
