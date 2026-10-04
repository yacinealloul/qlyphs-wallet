/** Wallet discovery and account-scoped requests with bounded lifetimes. */
import {
  CAPABILITIES,
  QlyphsError,
  isProvider,
  publicError,
  validTimeout,
} from '../../provider/src/index.ts';
import type {
  MintSessionSnapshot,
  MintSessionTerms,
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
import {
  accounts,
  command,
  immutable,
  invalid,
  manifest,
  mintSessionId,
  mintSessionLimits,
  mintSessionSnapshot,
  mintSessionTerms,
  providerState,
  submission,
  withinMintSessionLimits,
} from './validation.ts';
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
/** What a wallet that predates protocol version 2 is assumed to offer. */
export interface LegacyCapabilities {
  readonly protocolVersion: 1;
  readonly events: readonly [];
  readonly cancellation: false;
  readonly mintSessions?: null;
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
  /** Last capabilities read from the attached provider; gates the session event subscription. */
  private caps: { provider: QlyphsProvider; value: WalletCapabilities } | undefined;
  private session: MintSessionSnapshot | null = null;
  private sessionListeners = new Set<() => void>();
  private sessionDetach: (() => void) | undefined;
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
    this.dropSessionEvents();
    this.provider = provider;
    this.caps = undefined;
    this.revision++;
    this.setMintSession(null, true);
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
    if (!this.provider) {
      const discoveryOptions = {
        ...options,
        timeoutMs: Math.min(validTimeout(options.timeoutMs, 3_000), 3_000),
      };
      this.attach(
        await bounded(
          (signal) => discoverWallet({ ...discoveryOptions, signal, target: this.options.target }),
          discoveryOptions,
          3_000,
          undefined,
          this.controllers,
        ),
      );
    }
    this.assertOpen();
    return this.provider!;
  }
  private async invoke<M extends WalletMethod>(
    input: RequestInput<M>,
    options: RequestOptions = {},
  ): Promise<WalletRequestMap[M]['result']> {
    const maxMs = input.method === 'connect' ? 600_000 : 135_000;
    const timeoutMs = validTimeout(options.timeoutMs, 135_000, maxMs);
    const provider = await this.ready({ ...options, timeoutMs: Math.min(timeoutMs, 3_000) });
    this.assertOpen();
    const writing = input.method === 'requestTransaction' || input.method === 'requestMintSession';
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
            timeoutMs,
          }) as Promise<WalletRequestMap[M]['result']>;
        },
        options,
        135_000,
        writing ? 'unknown' : undefined,
        this.controllers,
        maxMs,
      );
    } catch (error) {
      throw publicError(error, 'UNAVAILABLE', writing ? 'unknown' : undefined);
    }
  }
  /**
   * `mintSessions` is normalized: absent (older wallets) or malformed becomes null. Test it for
   * truthiness before offering a mint session.
   */
  async capabilities(
    options: RequestOptions = {},
  ): Promise<WalletCapabilities | LegacyCapabilities> {
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
    const caps: WalletCapabilities = Object.freeze({
      ...value,
      methods: Object.freeze([...value.methods]),
      events: Object.freeze([...value.events]),
      mintSessions: mintSessionLimits((value as { mintSessions?: unknown }).mintSessions),
    });
    if (!this.closed && this.provider === p) {
      this.caps = { provider: p, value: caps };
      if (this.sessionListeners.size > 0) this.watchMintSession();
    }
    return caps;
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
    // A setup allowance does not extend the subsequent public-state read.
    return (
      await this.refresh({
        ...options,
        timeoutMs: Math.min(options.timeoutMs ?? 135_000, 135_000),
      })
    ).accounts;
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
  /**
   * Asks the wallet to review a bounded series of lot payments for one token. Resolves when the user
   * approves, with the running session; it never waits for the session to end. Like
   * `requestTransaction`, it is dispatched exactly once and shares its one-write-at-a-time rule.
   * After dispatch, a failure has outcome `unknown`: the session may have been approved and may have
   * signed payments. Tell the user to check the wallet window and Activity; never start another
   * session automatically.
   */
  async requestMintSession(
    terms: MintSessionTerms,
    options: RequestOptions & { owner?: string } = {},
  ): Promise<MintSessionSnapshot> {
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
    const canonical = mintSessionTerms(terms);
    const total = validTimeout(options.timeoutMs, 135_000);
    const started = Date.now();
    this.writing = true;
    try {
      let caps: WalletCapabilities | LegacyCapabilities;
      try {
        caps = await this.capabilities({ signal: options.signal, timeoutMs: total });
      } catch (error) {
        throw publicError(error, 'UNAVAILABLE', 'not-submitted');
      }
      if (
        caps.protocolVersion !== 2 ||
        !caps.methods.includes('requestMintSession') ||
        !caps.mintSessions ||
        !withinMintSessionLimits(canonical, caps.mintSessions)
      )
        throw new QlyphsError(
          'UNSUPPORTED_METHOD',
          'This wallet cannot run mint sessions',
          'not-submitted',
        );
      // Listen first, so no change the wallet sends right after approval is missed.
      this.watchMintSession();
      // The capability read spends part of the caller's budget, never extends it.
      const left = total - (Date.now() - started);
      if (left < 1)
        throw new QlyphsError('TIMEOUT', 'Operation stopped before dispatch', 'not-submitted');
      // Exactly one invocation. No catch path ever invokes a write again.
      const result = mintSessionSnapshot(
        await this.invoke(
          {
            method: 'requestMintSession',
            params: { owner: selected.owner, genesis: selected.genesis, terms: canonical },
          },
          { signal: options.signal, timeoutMs: left },
        ),
      );
      if (
        result.owner !== selected.owner ||
        result.genesis !== selected.genesis ||
        JSON.stringify(result.terms) !== JSON.stringify(canonical)
      )
        invalid();
      this.setMintSession(result);
      return result;
    } catch (error) {
      throw publicError(error, 'INVALID_RESPONSE', 'unknown');
    } finally {
      this.writing = false;
    }
  }
  /**
   * The session this page's wallet channel created, or null: none, another channel's, an origin
   * without its grant, or a wallet without mint sessions (answered without asking it).
   */
  async mintSession(options: RequestOptions = {}): Promise<MintSessionSnapshot | null> {
    try {
      if (!(await this.sessionsOffered(options))) {
        this.setMintSession(null);
        return null;
      }
      const value = await this.invoke({ method: 'mintSession' }, options);
      let next: MintSessionSnapshot | null = null;
      try {
        next = value === null ? null : mintSessionSnapshot(value);
      } catch (error) {
        this.setMintSession(null);
        throw error;
      }
      this.setMintSession(next);
      return next;
    } catch (error) {
      throw readError(error);
    }
  }
  /**
   * Asks the wallet to stop signing for `session`. It only reduces authority, so it is safe to call
   * again. Payments already sent stay valid until they land or their era ends; the returned snapshot
   * (`stopping` or `ended`) still shows the one that may be pending. Null when the session is not
   * visible to this page's channel.
   */
  async stopMintSession(
    session: string,
    options: RequestOptions = {},
  ): Promise<MintSessionSnapshot | null> {
    try {
      const id = mintSessionId(session);
      if (!(await this.sessionsOffered(options))) return null;
      const value = await this.invoke(
        { method: 'stopMintSession', params: { session: id } },
        options,
      );
      let next: MintSessionSnapshot | null = null;
      try {
        next = value === null ? null : mintSessionSnapshot(value);
        if (next && next.id !== id) invalid();
      } catch (error) {
        if (this.session?.id === id) this.setMintSession(null);
        throw error;
      }
      if (next || this.session?.id === id) this.setMintSession(next);
      return next;
    } catch (error) {
      throw readError(error);
    }
  }
  /** Latest session snapshot this connector knows: from replies and from `mintSessionChanged`. */
  getMintSession = (): MintSessionSnapshot | null => this.session;
  /**
   * Calls `listener` whenever `getMintSession()` changes. The wallet event is followed only once the
   * connector has read capabilities that list it, since older wallets reject unknown events.
   */
  subscribeMintSession = (listener: () => void): (() => void) => {
    this.assertOpen();
    this.sessionListeners.add(listener);
    this.watchMintSession();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.sessionListeners.delete(listener);
    };
  };
  /** Fresh capability read: whether the attached wallet serves the session methods at all. */
  private async sessionsOffered(options: RequestOptions): Promise<boolean> {
    const caps = await this.capabilities(options);
    const offered =
      caps.protocolVersion === 2 && caps.methods.includes('mintSession') && !!caps.mintSessions;
    if (offered) this.watchMintSession();
    return offered;
  }
  private watchMintSession() {
    const provider = this.provider,
      caps = this.caps;
    if (this.closed || this.sessionDetach || !provider || caps?.provider !== provider) return;
    if (
      provider.protocolVersion !== 2 ||
      typeof provider.on !== 'function' ||
      !caps.value.events.includes('mintSessionChanged')
    )
      return;
    const listener = (value: unknown) => {
      if (this.closed || this.provider !== provider) return;
      try {
        this.setMintSession(value === null ? null : mintSessionSnapshot(value));
      } catch {
        this.setMintSession(null, true);
      }
    };
    try {
      const off = provider.on('mintSessionChanged', listener);
      this.sessionDetach =
        typeof off === 'function'
          ? off
          : () => provider.removeListener?.('mintSessionChanged', listener);
    } catch {
      /* a wallet that refuses the event leaves the store to explicit reads */
    }
  }
  private dropSessionEvents() {
    const off = this.sessionDetach;
    this.sessionDetach = undefined;
    try {
      off?.();
    } catch {
      /* the provider is being replaced or destroyed */
    }
  }
  /**
   * `force` replaces the value unconditionally (resets and malformed data). Otherwise a snapshot
   * that is provably older than the stored one for the same session is ignored, so a reply that
   * arrives after a newer event cannot move the store backwards.
   */
  private setMintSession(next: MintSessionSnapshot | null, force = false) {
    if (
      next &&
      this.options.expectedGenesis !== undefined &&
      next.genesis !== this.options.expectedGenesis
    )
      next = null;
    const current = this.session;
    if (!force && next && current && current.id === next.id && older(next, current)) return;
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    this.session = next;
    for (const listener of [...this.sessionListeners]) {
      try {
        listener();
      } catch {
        /* isolate consumers */
      }
    }
  }
  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.revision++;
    this.detach?.();
    this.detach = undefined;
    this.dropSessionEvents();
    this.sessionListeners.clear();
    this.session = null;
    this.caps = undefined;
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
/** Signatures only grow and an ended session never runs again. */
function older(next: MintSessionSnapshot, current: MintSessionSnapshot): boolean {
  return (
    next.attempts.used < current.attempts.used ||
    (current.state === 'ended' && next.state !== 'ended')
  );
}
/** Session reads carry no write outcome. */
function readError(error: unknown): QlyphsError {
  const e = publicError(error, 'UNAVAILABLE');
  return new QlyphsError(e.code, e.message);
}
export const createWalletConnector = (options: ConnectorOptions = {}): WalletConnector =>
  new WalletConnector(options);
