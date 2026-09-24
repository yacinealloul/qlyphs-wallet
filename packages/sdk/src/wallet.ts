import {
  CAPABILITIES,
  QlyphsError,
  isProvider,
  publicError,
  validTimeout,
} from '../../provider/src/index.ts';
import type {
  QlyphsProvider,
  RequestInput,
  RequestOptions,
  WalletAccount,
  WalletCapabilities,
  WalletMethod,
  WalletRequestMap,
  ProviderState,
} from '../../provider/src/index.ts';
import type { TransactionCommand, SubmittedTransaction } from '../../native/src/public.ts';
import { bounded } from './async.ts';
import { accounts, command, immutable, manifest, providerState, submission } from './validation.ts';
import { hasSaleFee } from './fees.ts';
export interface WalletTarget {
  qlyphs?: unknown;
  addEventListener?(event: string, listener: EventListener): void;
  removeEventListener?(event: string, listener: EventListener): void;
}
function defaultTarget(): WalletTarget | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as WalletTarget);
}
export function detectWallet(
  target: WalletTarget | undefined = defaultTarget(),
): QlyphsProvider | null {
  try {
    return isProvider(target?.qlyphs) ? target.qlyphs : null;
  } catch {
    return null;
  }
}
export function discoverWallet(
  options: RequestOptions & { target?: WalletTarget } = {},
): Promise<QlyphsProvider> {
  const target = options.target ?? defaultTarget(),
    found = detectWallet(target);
  if (options.signal?.aborted)
    return Promise.reject(new QlyphsError('ABORTED', 'Discovery aborted'));
  if (found) return Promise.resolve(found);
  const ms = validTimeout(options.timeoutMs, 3_000);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      target?.removeEventListener?.('qlyphs:initialized', check);
      options.signal?.removeEventListener('abort', abort);
    };
    const check = () => {
      const provider = detectWallet(target);
      if (provider) {
        cleanup();
        resolve(provider);
      }
    };
    const abort = () => {
      cleanup();
      reject(new QlyphsError('ABORTED', 'Discovery aborted'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new QlyphsError('UNAVAILABLE', 'Install the Qlyphs Wallet and reload'));
    }, ms);
    target?.addEventListener?.('qlyphs:initialized', check);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    else check();
  });
}
export interface WalletSnapshot extends ProviderState {
  readonly available: boolean;
  readonly protocolVersion: 1 | 2;
}
export interface ConnectorOptions {
  provider?: QlyphsProvider;
  target?: WalletTarget;
  expectedGenesis?: string;
}
/** Stable snapshots and idempotent cleanup are suitable for future framework adapters. */
export class WalletConnector {
  private provider?: QlyphsProvider;
  private readonly options: ConnectorOptions;
  private snapshot: WalletSnapshot = immutable({
    accounts: [],
    network: null,
    connected: false,
    available: false,
    protocolVersion: 1,
  });
  private listeners = new Set<() => void>();
  private detach: (() => void) | undefined;
  private controllers = new Set<AbortController>();
  private revision = 0;
  private reads = 0;
  private closed = false;
  private writing = false;
  constructor(options: ConnectorOptions = {}) {
    this.options = options;
    if (options.provider) this.attach(options.provider);
  }
  getSnapshot = (): WalletSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.assertOpen();
    this.listeners.add(listener);
    // A stale disposer must not remove the same listener after a later remount.
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  };
  private assertOpen() {
    if (this.closed)
      throw new QlyphsError('DISCONNECTED', 'Connector has been destroyed', 'not-submitted');
  }
  private update(state: ProviderState, available = !!this.provider) {
    const next: WalletSnapshot = immutable({
      ...state,
      available,
      protocolVersion: this.provider?.protocolVersion ?? (1 as const),
    });
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        /* isolate consumers */
      }
    }
  }
  private attach(provider: QlyphsProvider) {
    if (this.provider === provider) return;
    this.assertOpen();
    this.detach?.();
    this.provider = provider;
    this.revision++;
    this.update({ accounts: [], network: null, connected: false });
    if (provider.protocolVersion === 2 && typeof provider.on === 'function') {
      const listener = (value: ProviderState) => {
        if (this.closed) return;
        this.revision++;
        try {
          this.update(providerState(value, this.options.expectedGenesis));
        } catch {
          this.update({ accounts: [], network: null, connected: false });
        }
      };
      const off = provider.on('stateChanged', listener);
      this.detach =
        typeof off === 'function' ? off : () => provider.removeListener?.('stateChanged', listener);
    }
  }
  private async ready(options: RequestOptions = {}) {
    this.assertOpen();
    if (!this.provider)
      this.attach(
        await bounded(
          (signal) => discoverWallet({ ...options, signal, target: this.options.target }),
          options,
          3_000,
          undefined,
          this.controllers,
        ),
      );
    this.assertOpen();
    return this.provider!;
  }
  private async invoke<M extends WalletMethod>(
    input: RequestInput<M>,
    options: RequestOptions = {},
  ): Promise<WalletRequestMap[M]['result']> {
    const provider = await this.ready(options);
    this.assertOpen();
    const writing = input.method === 'requestTransaction';
    try {
      return await bounded(
        (signal) => {
          if (writing) {
            const params = input.params as { owner: string; genesis: string };
            if (
              !this.snapshot.accounts.some(
                (a) => a.owner === params.owner && a.genesis === params.genesis,
              )
            )
              throw new QlyphsError(
                'CONTEXT_CHANGED',
                'Account context changed before dispatch',
                'not-submitted',
              );
          }
          return provider.request(input, {
            signal,
            timeoutMs: validTimeout(options.timeoutMs, 135_000),
          }) as Promise<WalletRequestMap[M]['result']>;
        },
        options,
        135_000,
        writing ? 'unknown' : undefined,
        this.controllers,
      );
    } catch (error) {
      throw publicError(error, 'UNAVAILABLE', writing ? 'unknown' : undefined);
    }
  }
  async capabilities(
    options: RequestOptions = {},
  ): Promise<
    WalletCapabilities | { protocolVersion: 1; events: readonly []; cancellation: false }
  > {
    const p = await this.ready(options);
    if (p.protocolVersion !== 2) return { protocolVersion: 1, events: [], cancellation: false };
    const value = await this.invoke({ method: 'capabilities' }, options);
    if (JSON.stringify(value) !== JSON.stringify(CAPABILITIES)) {
      // Require the capabilities used here, but tolerate additive fields/methods.
      if (
        value?.protocolVersion !== 2 ||
        !Array.isArray(value.methods) ||
        !value.methods.includes('state') ||
        !Array.isArray(value.events) ||
        !value.events.includes('stateChanged')
      )
        throw new QlyphsError('INVALID_RESPONSE', 'Unsupported provider capabilities');
    }
    return value;
  }
  async refresh(options: RequestOptions = {}): Promise<WalletSnapshot> {
    const provider = await this.ready(options),
      version = this.revision,
      read = ++this.reads;
    try {
      const state =
        provider.protocolVersion === 2
          ? providerState(
              await this.invoke({ method: 'state' }, options),
              this.options.expectedGenesis,
            )
          : await (async () => {
              const a = accounts(await this.invoke({ method: 'accounts' }, options));
              const raw = await this.invoke({ method: 'network' }, options);
              const n = raw === null ? null : manifest(raw, this.options.expectedGenesis);
              return providerState(
                { accounts: a, network: n, connected: a.length > 0 },
                this.options.expectedGenesis,
              );
            })();
      if (!this.closed && version === this.revision && read === this.reads) this.update(state);
    } catch (error) {
      if (!this.closed && version === this.revision && read === this.reads) {
        this.revision++;
        this.update({ accounts: [], network: null, connected: false });
      }
      throw error;
    }
    return this.snapshot;
  }
  async connect(options: RequestOptions = {}): Promise<readonly WalletAccount[]> {
    accounts(await this.invoke({ method: 'connect' }, options));
    return (await this.refresh(options)).accounts;
  }
  async disconnect(options: RequestOptions = {}): Promise<void> {
    try {
      await this.invoke({ method: 'disconnect' }, options);
    } finally {
      this.revision++;
      if (!this.closed)
        this.update({ accounts: [], network: this.snapshot.network, connected: false });
    }
  }
  async requestTransaction(
    input: TransactionCommand,
    options: RequestOptions & { owner?: string } = {},
  ): Promise<SubmittedTransaction> {
    this.assertOpen();
    if (this.writing)
      throw new QlyphsError('BUSY', 'A wallet transaction is already pending', 'not-submitted');
    const selected = options.owner
      ? this.snapshot.accounts.find((a) => a.owner === options.owner)
      : this.snapshot.accounts[0];
    if (!selected || !this.snapshot.connected)
      throw new QlyphsError(
        'UNAUTHORIZED',
        'Connect this application explicitly first',
        'not-submitted',
      );
    const canonical = command(input);
    if (canonical.kind === 'sell' && !hasSaleFee(canonical.offer))
      throw new QlyphsError(
        'INVALID_REQUEST',
        'A sell offer must commit fee = saleFee(price) to QLYPHS_FEE_ACCOUNT (see withSaleFee)',
        'not-submitted',
      );
    this.writing = true;
    try {
      // Exactly one invocation. No catch path ever invokes a write again.
      return submission(
        await this.invoke(
          {
            method: 'requestTransaction',
            params: { owner: selected.owner, genesis: selected.genesis, command: canonical },
          },
          options,
        ),
      );
    } catch (error) {
      throw publicError(error, 'INVALID_RESPONSE', 'unknown');
    } finally {
      this.writing = false;
    }
  }
  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.revision++;
    this.detach?.();
    this.detach = undefined;
    for (const controller of [...this.controllers]) controller.abort();
    this.controllers.clear();
    this.listeners.clear();
    this.snapshot = immutable({
      accounts: [],
      network: null,
      connected: false,
      available: false,
      protocolVersion: this.provider?.protocolVersion ?? 1,
    });
    this.provider = undefined;
  }
}
export const createWalletConnector = (options: ConnectorOptions = {}): WalletConnector =>
  new WalletConnector(options);
