/** Read-only explorer contract. Monetary quantities stay in decimal base units. */
export type ExplorerNetwork = 'mainnet' | 'development';
export type ExplorerView =
  | 'overview'
  | 'blocks'
  | 'transactions'
  | 'tokens'
  | 'reservations'
  | 'block'
  | 'transaction'
  | 'address'
  | 'token'
  | 'search';
export interface ExplorerLink {
  view: ExplorerView;
  id: string;
  label: string;
}
export interface ExplorerField {
  label: string;
  value: string;
  link?: ExplorerLink;
}
export interface ExplorerBlock {
  height: number;
  hash: string;
  transactions: number;
  finalized: boolean;
  timestamp?: string;
  miner?: string;
}
export interface ExplorerTransaction {
  hash: string;
  height: number;
  index: number;
  from: string | null;
  to?: string;
  method: string;
  success: boolean;
  finalized: boolean;
  amount?: string;
  fee?: string;
  timestamp?: string;
  protocol: string | null;
}
export interface ExplorerToken {
  id: string;
  symbol: string;
  creator: string;
  decimals: number;
  minted: string;
  cap: string;
  limit: string;
  policy: string;
  available?: string;
}
export interface ExplorerReservation {
  id: string;
  asset: string;
  symbol: string;
  decimals: number;
  seller: string;
  buyer: string;
  amount: string;
  price: string;
  status: string;
  height: number;
  expiry: number;
  settlement?: string;
}
export interface ExplorerData {
  network: ExplorerNetwork;
  source: string;
  updatedAt: string;
  ready: boolean;
  head: number;
  finalized: number;
  genesis?: string;
  activation?: number;
  stats: { label: string; value: string; hint: string }[];
  blocks: ExplorerBlock[];
  transactions: ExplorerTransaction[];
  transaction?: ExplorerTransaction;
  eventsTruncated?: boolean;
  tokens: ExplorerToken[];
  reservations: ExplorerReservation[];
  more: boolean;
  title?: string;
  note?: string;
  fields?: ExplorerField[];
  events?: unknown[];
  callHex?: string;
  results?: ExplorerLink[];
  chart?: { label: string; value: number }[];
}
