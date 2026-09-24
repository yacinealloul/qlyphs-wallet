/** JSON contracts for the existing native API. Big integers never cross as numbers. */
import type { Command } from './commands.ts';
import type { Manifest, NetworkName } from './network.ts';
import type { Asset, Block, Ticket } from './protocol.ts';
export type JsonWire<T> = T extends bigint
  ? string
  : T extends readonly (infer U)[]
    ? JsonWire<U>[]
    : T extends object
      ? { [K in keyof T]: JsonWire<T[K]> }
      : T;
/** Only commands accepted by parseCommand; a raw offer is not a public command. */
export type TransactionCommand = JsonWire<Exclude<Command, { kind: 'offer' }>>;
export interface IndexerStatus {
  network: NetworkName;
  protocol: 'QLYP-v1';
  /** True exactly when network is 'mainnet'. */
  mainnetEnabled: boolean;
  manifest: Manifest;
  ready: boolean;
  head: number;
  finalized: number;
  checkpoint: string;
  stateDigest: string;
  lastSync: number;
  error: string | null;
  faucet?: boolean;
  pqWitnessesConfigured?: boolean;
}
export interface NativeBalance {
  free: string;
  reserved: string;
  frozen: string;
  /** The finalized part: what the wallet will actually spend (it never spends unfinalized QTC). */
  finalized?: { free: string; frozen: string };
}
export type PublicAsset = JsonWire<Asset> & { id: string };
export interface PublicState {
  status: IndexerStatus;
  sequence: string;
  assets: (PublicAsset & { available: string })[];
  offers: (JsonWire<Ticket> & { finalized: boolean })[];
  pairs: { id: string; signers: string[]; threshold: number }[];
  offset: number;
  more: boolean;
}
export interface PublicTicket {
  ticket: JsonWire<Ticket>;
  finalized: boolean;
  finalizedHeight: number;
  finalizedTicket?: JsonWire<Ticket> | null;
}
export type PublicBlock = JsonWire<Block>;
export interface TransactionReceipt {
  hash: string;
  status: 'pending' | 'included' | 'finalized' | 'expired' | 'indexer-unavailable';
  height?: number;
  nativeSuccess: boolean | null;
  verdict: string | null;
}
export interface SubmittedTransaction {
  hash: string;
  status: 'submitted' | 'broadcast-uncertain';
  asset?: string;
}
/** GET /api/symbol?symbol= (docs/native/INSCRIPTIONS.md §4). `asset` is the id holding the
 * symbol, or null when it is available. */
export interface PublicSymbol {
  symbol: string;
  available: boolean;
  asset: string | null;
}
/** One inscription in a list (GET /api/inscriptions): never carries the content. */
export interface PublicInscriptionSummary {
  id: string;
  number: number;
  creator: string;
  /** Current holder: the account with balance 1, or the seller while it is locked in an offer. */
  owner: string;
  /** True while the inscription is locked in a live offer (owner = the seller). */
  locked: boolean;
  contentType: string;
  /** Content length in bytes. */
  size: number;
  /** sha256(content) as 0x-prefixed lowercase hex; for convenience only, not an identity. */
  sha256: string;
  height: number;
}
/** GET /api/inscription?id= or ?number=: the summary plus the content as 0x-prefixed hex. */
export type PublicInscription = PublicInscriptionSummary & { content: string };
/** GET /api/inscriptions?offset=&owner=: newest first, 50 per page. */
export interface PublicInscriptions {
  inscriptions: PublicInscriptionSummary[];
  offset: number;
  more: boolean;
  total: number;
}
