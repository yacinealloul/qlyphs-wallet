import type {
  IndexerStatus,
  NativeBalance,
  PublicState,
  PublicAsset,
  PublicTicket,
  PublicBlock,
  PublicInscription,
  PublicInscriptions,
  PublicSymbol,
  TransactionReceipt,
} from '../../native/src/public.ts';
import type { ExplorerData, ExplorerView } from '../../shared/src/explorer.ts';
import { QlyphsError } from '../../provider/src/index.ts';
import type { RequestOptions } from '../../provider/src/index.ts';
import { bounded } from './async.ts';
import { asAccountId, asAssetId, asTicketKey, asTransactionHash, httpBase } from './identifiers.ts';
import * as read from './validation.ts';
export interface IndexerOptions {
  baseUrl: string;
  expectedGenesis?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}
export class IndexerError extends QlyphsError {
  readonly status: number;
  constructor(status: number) {
    super('UNAVAILABLE', `Indexer HTTP ${status}`);
    this.name = 'IndexerError';
    this.status = status;
  }
}
export interface ActivityItem {
  hash: string;
  height: number;
  success: 0 | 1;
  verdict: string | null;
}
function offset(value: number | undefined, fallback = 0): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000)
    throw new QlyphsError('INVALID_REQUEST', 'Invalid pagination offset');
  return n;
}
async function readJson(response: Response): Promise<unknown> {
  const maximum = 4 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > maximum) read.invalid();
  const reader = response.body?.getReader();
  if (!reader) read.invalid();
  const decoder = new TextDecoder();
  let text = '',
    bytes = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        read.invalid();
      }
      text += decoder.decode(result.value, { stream: true });
    }
    text += decoder.decode();
    try {
      return JSON.parse(text);
    } catch {
      read.invalid();
    }
  } finally {
    reader.releaseLock();
  }
}
/** GET-only client. No submit, faucet, signing, raw bytes or payment retry API. */
export class IndexerClient {
  readonly baseUrl: string;
  readonly expectedGenesis?: string;
  private readonly options: IndexerOptions;
  constructor(options: IndexerOptions) {
    this.baseUrl = httpBase(options.baseUrl).href;
    if (options.expectedGenesis !== undefined) asTransactionHash(options.expectedGenesis);
    this.expectedGenesis = options.expectedGenesis;
    this.options = options;
  }
  private get<T>(
    path: string,
    decode: (value: unknown) => T,
    options: RequestOptions = {},
  ): Promise<T> {
    return bounded(
      async (signal) => {
        let response: Response;
        try {
          response = await (this.options.fetch ?? globalThis.fetch)(
            new URL('api/' + path, this.baseUrl),
            {
              method: 'GET',
              signal,
              credentials: 'omit',
              redirect: 'error',
              headers: { accept: 'application/json' },
            },
          );
        } catch {
          throw new QlyphsError('UNAVAILABLE', 'Configured indexer is unavailable');
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new IndexerError(response.status);
        }
        const value = await readJson(response);
        try {
          return decode(value);
        } catch (error) {
          if (error instanceof QlyphsError && error.code === 'NETWORK_MISMATCH') throw error;
          read.invalid();
        }
      },
      { ...options, timeoutMs: options.timeoutMs ?? this.options.timeoutMs },
      15_000,
    );
  }
  status(options: RequestOptions = {}): Promise<IndexerStatus> {
    return this.get('status', (value) => read.status(value, this.expectedGenesis), options);
  }
  state(
    query: { owner?: string; offset?: number } = {},
    options: RequestOptions = {},
  ): Promise<PublicState> {
    const params = new URLSearchParams({ offset: String(offset(query.offset)) });
    if (query.owner !== undefined) params.set('owner', asAccountId(query.owner));
    return this.get('state?' + params, (value) => read.state(value, this.expectedGenesis), options);
  }
  private async checked<T>(
    path: string,
    decode: (value: unknown) => T,
    options: RequestOptions,
  ): Promise<T> {
    // Responses without a manifest are checked against the configured dev service first.
    return bounded(
      async (signal) => {
        await this.status({ ...options, signal });
        return this.get(path, decode, { ...options, signal });
      },
      { ...options, timeoutMs: options.timeoutMs ?? this.options.timeoutMs },
      15_000,
    );
  }
  balance(owner: string, options: RequestOptions = {}): Promise<NativeBalance> {
    return this.checked('balance?owner=' + asAccountId(owner), read.balance, options);
  }
  asset(asset: string, options: RequestOptions = {}): Promise<PublicAsset> {
    const id = asAssetId(asset);
    return this.checked(
      'asset?id=' + id,
      (value) => {
        const result = read.asset(value);
        if (result.id !== id) read.invalid();
        return result;
      },
      options,
    );
  }
  /** Whether a token symbol is still free (docs/native/INSCRIPTIONS.md §1). Symbols are unique:
   * a DEPLOY of a taken symbol is rejected and its fee is not refunded, so check right
   * before requesting one; a claim in the same block can still win. */
  symbol(symbol: string, options: RequestOptions = {}): Promise<PublicSymbol> {
    if (typeof symbol !== 'string' || !/^[A-Z0-9]{1,12}$/.test(symbol))
      throw new QlyphsError(
        'INVALID_REQUEST',
        'A symbol of 1-12 characters A-Z or 0-9 is required',
      );
    return this.checked(
      'symbol?symbol=' + symbol,
      (value) => read.symbolStatus(value, symbol),
      options,
    );
  }
  /** Quarks (inscriptions), newest (highest number) first, at most 50 per page, without content.
   * With `owner`, only the inscriptions that account holds (including ones locked in its offers). */
  inscriptions(
    query: { offset?: number; owner?: string } = {},
    options: RequestOptions = {},
  ): Promise<PublicInscriptions> {
    const n = offset(query.offset);
    const params = new URLSearchParams({ offset: String(n) });
    const owner = query.owner === undefined ? undefined : asAccountId(query.owner);
    if (owner !== undefined) params.set('owner', owner);
    return this.checked(
      'inscriptions?' + params,
      (value) => read.inscriptions(value, n, owner),
      options,
    );
  }
  /** One inscription with its content (0x hex; its length and SHA-256 are checked), by asset id
   * or by number. An unknown inscription is IndexerError 404. Render the content only as
   * docs/native/INSCRIPTIONS.md §5 allows: never as HTML or script. */
  inscription(
    query: { id: string; number?: undefined } | { number: number; id?: undefined },
    options: RequestOptions = {},
  ): Promise<PublicInscription> {
    const q = (query ?? {}) as { id?: unknown; number?: unknown };
    if ((q.id === undefined) === (q.number === undefined))
      throw new QlyphsError('INVALID_REQUEST', 'Exactly one of id or number is required');
    let path: string, matches: (x: PublicInscription) => boolean;
    if (q.id !== undefined) {
      const id = asAssetId(q.id as string);
      path = 'inscription?id=' + id;
      matches = (x) => x.id === id;
    } else {
      const n = q.number;
      if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1)
        throw new QlyphsError('INVALID_REQUEST', 'A positive Quark number is required');
      path = 'inscription?number=' + n;
      matches = (x) => x.number === n;
    }
    return this.checked(
      path,
      (value) => {
        const result = read.inscription(value);
        if (!matches(result)) read.invalid();
        return result;
      },
      options,
    );
  }
  ticket(key: string, options: RequestOptions = {}): Promise<PublicTicket> {
    const id = asTicketKey(key);
    return this.checked(
      'ticket?key=' + encodeURIComponent(id),
      (value) => {
        const result = read.ticket(value);
        if (
          result.ticket.key !== id ||
          (result.finalizedTicket && result.finalizedTicket.key !== id)
        )
          read.invalid();
        return result;
      },
      options,
    );
  }
  transaction(hash: string, options: RequestOptions = {}): Promise<TransactionReceipt> {
    const id = asTransactionHash(hash);
    return this.checked('transactions/' + id, (value) => read.receipt(value, id), options);
  }
  activity(
    owner: string,
    before = 2147483647,
    options: RequestOptions = {},
  ): Promise<{ items: ActivityItem[] }> {
    if (!Number.isSafeInteger(before) || before < 0 || before > 2147483647)
      throw new QlyphsError('INVALID_REQUEST', 'Invalid activity cursor');
    return this.checked(
      `activity?owner=${asAccountId(owner)}&before=${before}`,
      (value) => ({
        items: read.list(
          read.object(value).items,
          (item) => {
            const row = read.object(item);
            const success = read.integer(row.success, 1) as 0 | 1;
            return {
              hash: read.id(row.hash),
              height: read.integer(row.height),
              success,
              verdict: row.verdict === null ? null : read.text(row.verdict, 2048),
            };
          },
          30,
        ),
      }),
      options,
    );
  }
  block(height: number, options: RequestOptions = {}): Promise<PublicBlock> {
    const n = offset(height);
    return this.checked(
      'blocks/' + n,
      (value) => {
        const b = read.object(value);
        if (read.integer(b.height) !== n) read.invalid();
        read.id(b.hash);
        read.id(b.parent);
        read.integer(b.spec);
        read.integer(b.txVersion);
        read.integer(b.finalized);
        read.list(b.receipts, (value) => {
          const r = read.object(value);
          read.id(r.hash);
          read.integer(r.index);
          if (r.signer !== null) read.id(r.signer);
          read.text(r.callHex, 65536);
          read.flag(r.success);
          read.list(r.events, (value) => {
            const event = read.object(value);
            read.text(event.kind, 80);
            if (event.kind === 'paid') {
              read.amount(event.amount);
              read.id(event.from);
              read.id(event.to);
            }
          });
        });
        return value as PublicBlock;
      },
      options,
    );
  }
  explorer(
    query: { view?: ExplorerView; id?: string; offset?: number; at?: number } = {},
    options: RequestOptions = {},
  ): Promise<ExplorerData> {
    const view = query.view ?? 'overview';
    if (
      ![
        'overview',
        'blocks',
        'transactions',
        'tokens',
        'reservations',
        'block',
        'transaction',
        'address',
        'token',
        'search',
      ].includes(view)
    )
      throw new QlyphsError('INVALID_REQUEST', 'Unknown explorer view');
    const params = new URLSearchParams({ view, offset: String(offset(query.offset)) });
    if (query.id !== undefined) {
      if (query.id.length > 256)
        throw new QlyphsError('INVALID_REQUEST', 'Explorer identifier too long');
      if (view === 'transaction') asTransactionHash(query.id);
      if (view === 'address') asAccountId(query.id);
      if (view === 'token') asAssetId(query.id);
      params.set('id', query.id);
    }
    if (query.at !== undefined) params.set('at', String(offset(query.at)));
    return this.checked(
      'explorer?' + params,
      (value) => {
        const data = read.object(value);
        if (
          (data.network !== 'development' && data.network !== 'mainnet') ||
          (this.expectedGenesis && data.genesis !== this.expectedGenesis)
        )
          throw new QlyphsError('NETWORK_MISMATCH', 'Wrong explorer network');
        read.id(data.genesis);
        read.flag(data.ready);
        read.flag(data.more);
        read.integer(data.head);
        read.integer(data.finalized);
        read.text(data.source);
        read.text(data.updatedAt);
        for (const field of ['stats', 'blocks', 'transactions', 'tokens', 'reservations'])
          read.list(data[field], read.object);
        if (data.transaction !== undefined) {
          const tx = read.object(data.transaction);
          read.id(tx.hash);
          read.flag(tx.success);
          read.flag(tx.finalized);
          if (view === 'transaction' && tx.hash !== query.id) read.invalid();
        }
        return value as ExplorerData;
      },
      options,
    );
  }
}
export const createIndexerClient = (options: IndexerOptions): IndexerClient =>
  new IndexerClient(options);
