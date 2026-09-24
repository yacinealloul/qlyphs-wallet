import { QlyphsError, validTimeout } from '../../provider/src/index.ts';
import type { RequestOptions, WriteOutcome } from '../../provider/src/index.ts';
/** A single invocation. Cancellation stops waiting; it does not undo a submitted payment. */
export function bounded<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options: RequestOptions = {},
  defaultMs = 15_000,
  outcome?: WriteOutcome,
  controllers?: Set<AbortController>,
): Promise<T> {
  const ms = validTimeout(options.timeoutMs, defaultMs);
  if (options.signal?.aborted)
    return Promise.reject(new QlyphsError('ABORTED', 'Aborted before dispatch', 'not-submitted'));
  const controller = new AbortController();
  controllers?.add(controller);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', aborted);
      controller.signal.removeEventListener('abort', ownAbort);
      controllers?.delete(controller);
    };
    const fail = (code: 'ABORTED' | 'TIMEOUT') => {
      if (settled) return;
      settled = true;
      cleanup();
      controller.abort();
      reject(new QlyphsError(code, 'Operation stopped. No automatic write retry.', outcome));
    };
    const aborted = () => fail('ABORTED'),
      ownAbort = () => fail('ABORTED');
    const timer = setTimeout(() => fail('TIMEOUT'), ms);
    options.signal?.addEventListener('abort', aborted, { once: true });
    controller.signal.addEventListener('abort', ownAbort, { once: true });
    if (options.signal?.aborted) {
      fail('ABORTED');
      return;
    }
    Promise.resolve()
      .then(() => {
        if (settled) throw new QlyphsError('ABORTED', 'Aborted before dispatch', 'not-submitted');
        return run(controller.signal);
      })
      .then(
        (value) => {
          if (!settled) {
            settled = true;
            cleanup();
            resolve(value);
          }
        },
        (error: unknown) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(error);
          }
        },
      );
  });
}
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new QlyphsError('ABORTED', 'Tracking aborted'));
      return;
    }
    const stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      stop();
      reject(new QlyphsError('ABORTED', 'Tracking aborted'));
    };
    const timer = setTimeout(() => {
      stop();
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
