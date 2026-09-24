import { fromHex, isContentType, MAX_PAYLOAD, MAX_U128, MAX_U64 } from '../../native/src/codec.ts';
import { sha256 } from './sha256.ts';
import { MAINNET, PROTOCOL_LABEL } from '../../native/src/protocol.ts';
import { json, parseCommand } from '../../native/src/commands.ts';
import { QlyphsError } from '../../provider/src/index.ts';
import type { Manifest, ProviderState, WalletAccount } from '../../provider/src/index.ts';
import type { NetworkName } from '../../native/src/network.ts';
import type {
  IndexerStatus,
  NativeBalance,
  PublicAsset,
  PublicInscription,
  PublicInscriptions,
  PublicInscriptionSummary,
  PublicState,
  PublicSymbol,
  PublicTicket,
  TransactionReceipt,
  SubmittedTransaction,
  TransactionCommand,
} from '../../native/src/public.ts';

export function invalid(): never {
  throw new QlyphsError('INVALID_RESPONSE', 'Invalid public response from the configured service');
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 512): string {
  if (typeof value !== 'string' || value.length > max) invalid();
  return value;
}
export function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    invalid();
  return value;
}
export function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}
export function id(value: unknown, bytes = 32): string {
  const s = text(value, bytes * 2 + 2);
  try {
    fromHex(s, bytes);
  } catch {
    invalid();
  }
  return s;
}
export function amount(value: unknown, max = MAX_U128): string {
  const s = text(value, 39);
  if (!/^(0|[1-9]\d*)$/.test(s) || BigInt(s) > max) invalid();
  return s;
}
export function list<T>(value: unknown, read: (item: unknown) => T, max = 10_000): T[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value.map(read);
}
export function manifest(value: unknown, expectedGenesis?: string): Manifest {
  const v = object(value),
    activation = object(v.activation);
  // Mainnet is read only from a pinned activation block after genesis.
  const known =
    v.network === 'development'
      ? v.genesis !== MAINNET
      : v.network === 'mainnet' && v.genesis === MAINNET && integer(activation.height) > 0;
  if (!known || v.format !== 1) throw new QlyphsError('NETWORK_MISMATCH', 'Unsupported network');
  const genesis = id(v.genesis);
  if (expectedGenesis !== undefined && genesis !== expectedGenesis)
    throw new QlyphsError(
      'NETWORK_MISMATCH',
      'Wallet and configured indexer use different networks',
    );
  return {
    format: 1,
    network: v.network as NetworkName,
    genesis,
    runtimeHash: id(v.runtimeHash),
    activation: { hash: id(activation.hash), height: integer(activation.height) },
  };
}
export function accounts(value: unknown): WalletAccount[] {
  return list(
    value,
    (item) => {
      const a = object(item);
      const address = text(a.address, 128);
      if (!address) invalid();
      return { owner: id(a.owner), genesis: id(a.genesis), address };
    },
    20,
  );
}
export function providerState(value: unknown, expectedGenesis?: string): ProviderState {
  const v = object(value),
    a = accounts(v.accounts),
    network = v.network === null ? null : manifest(v.network, expectedGenesis);
  if (
    flag(v.connected) !== a.length > 0 ||
    a.some((account) => !network || account.genesis !== network.genesis)
  )
    invalid();
  return { accounts: a, network, connected: a.length > 0 };
}
export function status(value: unknown, expectedGenesis?: string): IndexerStatus {
  const s = object(value);
  if (
    (s.network !== 'development' && s.network !== 'mainnet') ||
    s.protocol !== PROTOCOL_LABEL ||
    s.mainnetEnabled !== (s.network === 'mainnet')
  )
    throw new QlyphsError('NETWORK_MISMATCH', 'Unexpected indexer network or protocol');
  const m = manifest(s.manifest, expectedGenesis);
  if (m.network !== s.network)
    throw new QlyphsError('NETWORK_MISMATCH', 'Indexer manifest network differs');
  const head = integer(s.head),
    finalized = integer(s.finalized);
  if (finalized > head) invalid();
  return {
    network: m.network,
    protocol: PROTOCOL_LABEL,
    mainnetEnabled: m.network === 'mainnet',
    manifest: m,
    ready: flag(s.ready),
    head,
    finalized,
    checkpoint: id(s.checkpoint),
    stateDigest: text(s.stateDigest),
    lastSync: integer(s.lastSync),
    error: s.error === null ? null : text(s.error),
    ...(s.faucet === undefined ? {} : { faucet: flag(s.faucet) }),
    ...(s.pqWitnessesConfigured === undefined
      ? {}
      : { pqWitnessesConfigured: flag(s.pqWitnessesConfigured) }),
  };
}
export function balance(value: unknown): NativeBalance {
  const v = object(value);
  const base = { free: amount(v.free), reserved: amount(v.reserved), frozen: amount(v.frozen) };
  if (v.finalized === undefined) return base;
  const f = object(v.finalized);
  return { ...base, finalized: { free: amount(f.free), frozen: amount(f.frozen) } };
}
/** Parse transaction commands through the existing canonical parser, not a second rule set. */
export function command(value: unknown): TransactionCommand {
  try {
    return JSON.parse(json(parseCommand(value))) as TransactionCommand;
  } catch {
    throw new QlyphsError(
      'INVALID_REQUEST',
      'Invalid canonical transaction command',
      'not-submitted',
    );
  }
}
function exactKeys(v: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(v).length !== keys.length || !keys.every((k) => k in v)) invalid();
}
/** A deployed definition goes through the canonical deploy parser. A Quark (inscription) is not a
 * DEPLOY command, so it is accepted only with exactly the inscription definition. */
export function assetDefinition(value: unknown): PublicAsset['definition'] {
  const v = object(value);
  if (v.policy === 'inscription') {
    // A Quark (docs/native/INSCRIPTIONS.md §2): exactly INSCRIPTION_DEFINITION.
    exactKeys(v, ['kind', 'symbol', 'decimals', 'cap', 'limit', 'policy']);
    if (
      v.kind !== 'deploy' ||
      v.symbol !== '' ||
      v.decimals !== 0 ||
      v.cap !== '1' ||
      v.limit !== '0'
    )
      invalid();
    return { kind: 'deploy', symbol: '', decimals: 0, cap: '1', limit: '0', policy: 'inscription' };
  }
  const definition = command(v);
  if (definition.kind !== 'deploy') invalid();
  return definition;
}
export function asset(value: unknown): PublicAsset {
  const v = object(value),
    definition = assetDefinition(v.definition),
    minted = amount(v.minted);
  // An inscription is minted exactly once, at INSCRIBE, and can never be minted again.
  if (definition.policy === 'inscription' && minted !== '1') invalid();
  return { id: id(v.id, 40), creator: id(v.creator), definition, minted };
}
const SYMBOL = /^[A-Z0-9]{1,12}$/;
/** GET /api/symbol: the symbol asked for, `available` exactly when no asset holds it. */
export function symbolStatus(value: unknown, expectedSymbol: string): PublicSymbol {
  const v = object(value);
  exactKeys(v, ['symbol', 'available', 'asset']);
  const available = flag(v.available),
    asset = v.asset === null ? null : id(v.asset, 40);
  if (v.symbol !== expectedSymbol || !SYMBOL.test(expectedSymbol) || available !== (asset === null))
    invalid();
  return { symbol: expectedSymbol, available, asset };
}
const SUMMARY_KEYS = [
  'id',
  'number',
  'creator',
  'owner',
  'locked',
  'contentType',
  'size',
  'sha256',
  'height',
];
function summaryFields(v: Record<string, unknown>): PublicInscriptionSummary {
  const number = integer(v.number),
    size = integer(v.size, MAX_PAYLOAD),
    sha = text(v.sha256, 66);
  if (number < 1 || size < 1 || !/^0x[0-9a-f]{64}$/.test(sha) || !isContentType(v.contentType))
    invalid();
  return {
    id: id(v.id, 40),
    number,
    creator: id(v.creator),
    owner: id(v.owner),
    locked: flag(v.locked),
    contentType: v.contentType,
    size,
    sha256: sha,
    height: integer(v.height, 0xffffffff),
  };
}
/** One inscription in a list (GET /api/inscriptions): exactly the summary, never the content. */
export function inscriptionSummary(value: unknown): PublicInscriptionSummary {
  const v = object(value);
  exactKeys(v, SUMMARY_KEYS);
  return summaryFields(v);
}
/** GET /api/inscription: the summary plus the content, whose length and SHA-256 must match. */
export function inscription(value: unknown): PublicInscription {
  const v = object(value);
  exactKeys(v, [...SUMMARY_KEYS, 'content']);
  const summary = summaryFields(v),
    content = text(v.content, 2 + 2 * MAX_PAYLOAD);
  if (!/^0x(?:[0-9a-f]{2})+$/.test(content) || content.length !== 2 + 2 * summary.size) invalid();
  if (sha256(fromHex(content)) !== summary.sha256) invalid();
  return { ...summary, content };
}
export const INSCRIPTION_PAGE_MAX = 50;
/** GET /api/inscriptions: newest (highest number) first; with `owner`, only what it holds. */
export function inscriptions(
  value: unknown,
  expectedOffset: number,
  expectedOwner?: string,
): PublicInscriptions {
  const v = object(value);
  exactKeys(v, ['inscriptions', 'offset', 'more', 'total']);
  const items = list(v.inscriptions, inscriptionSummary, INSCRIPTION_PAGE_MAX),
    offset = integer(v.offset, 1_000_000),
    total = integer(v.total),
    more = flag(v.more);
  if (
    offset !== expectedOffset ||
    offset + items.length > total ||
    more !== total > offset + items.length ||
    new Set(items.map((i) => i.id)).size !== items.length ||
    (expectedOwner !== undefined && items.some((i) => i.owner !== expectedOwner))
  )
    invalid();
  for (let i = 1; i < items.length; i++) if (items[i]!.number >= items[i - 1]!.number) invalid();
  // Numbers run 1..total without gaps, so an unfiltered page is exactly total - offset downwards.
  if (expectedOwner === undefined && items.some((x, i) => x.number !== total - offset - i))
    invalid();
  return { inscriptions: items, offset, more, total };
}
export function ticketRecord(value: unknown): PublicTicket['ticket'] {
  const v = object(value),
    parsed = command({ kind: 'sell', multisig: v.multisig, offer: v.offer });
  const key = command({ kind: 'cancel', ticket: v.key });
  if (
    parsed.kind !== 'sell' ||
    key.kind !== 'cancel' ||
    !['locked', 'settled', 'released'].includes(String(v.status))
  )
    invalid();
  const proposal = integer(v.proposal, 0xffffffff);
  if (v.key !== `${parsed.multisig}:${proposal}`) invalid();
  const callHex = text(v.callHex, 65536);
  try {
    fromHex(callHex);
  } catch {
    invalid();
  }
  return {
    key: key.ticket,
    multisig: parsed.multisig,
    proposal,
    seller: id(v.seller),
    offer: parsed.offer,
    callHex,
    createdHeight: integer(v.createdHeight),
    status: v.status as PublicTicket['ticket']['status'],
    ...(v.settlement === undefined ? {} : { settlement: id(v.settlement) }),
  };
}
export function ticket(value: unknown): PublicTicket {
  const v = object(value);
  return {
    ticket: ticketRecord(v.ticket),
    finalized: flag(v.finalized),
    finalizedHeight: integer(v.finalizedHeight),
    ...(v.finalizedTicket === undefined
      ? {}
      : { finalizedTicket: v.finalizedTicket === null ? null : ticketRecord(v.finalizedTicket) }),
  };
}
export function state(value: unknown, expectedGenesis?: string): PublicState {
  const v = object(value);
  return {
    status: status(v.status, expectedGenesis),
    sequence: amount(v.sequence, MAX_U64),
    assets: list(v.assets, (a) => ({ ...asset(a), available: amount(object(a).available) }), 100),
    offers: list(
      v.offers,
      (t) => ({ ...ticketRecord(t), finalized: flag(object(t).finalized) }),
      100,
    ),
    pairs: list(
      v.pairs,
      (p) => {
        const pair = object(p);
        return {
          id: id(pair.id),
          signers: list(pair.signers, (s) => id(s), 20),
          threshold: integer(pair.threshold, 20),
        };
      },
      100,
    ),
    offset: integer(v.offset, 1_000_000),
    more: flag(v.more),
  };
}
export function receipt(value: unknown, expectedHash: string): TransactionReceipt {
  const v = object(value),
    hash = id(v.hash);
  if (
    hash !== expectedHash ||
    !['pending', 'included', 'finalized', 'expired', 'indexer-unavailable'].includes(
      String(v.status),
    )
  )
    invalid();
  const verdict = v.verdict === null ? null : text(v.verdict, 2048);
  if (verdict !== null && verdict !== 'accepted' && !verdict.startsWith('rejected: ')) invalid();
  const nativeSuccess = v.nativeSuccess === null ? null : flag(v.nativeSuccess);
  const seen = v.status === 'included' || v.status === 'finalized';
  if (seen && (v.height === undefined || nativeSuccess === null)) invalid();
  if (!seen && (nativeSuccess !== null || verdict !== null || v.height !== undefined)) invalid();
  return {
    hash,
    status: v.status as TransactionReceipt['status'],
    nativeSuccess,
    verdict,
    ...(v.height === undefined ? {} : { height: integer(v.height) }),
  };
}
export function submission(value: unknown): SubmittedTransaction {
  const v = object(value);
  if (v.status !== 'submitted' && v.status !== 'broadcast-uncertain') invalid();
  return {
    hash: id(v.hash),
    status: v.status,
    ...(v.asset === undefined ? {} : { asset: id(v.asset, 40) }),
  };
}
export function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) immutable(item);
    Object.freeze(value);
  }
  return value;
}
