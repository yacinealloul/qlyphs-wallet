import { fromHex, uint, assetId as deriveAssetId } from '../../native/src/codec.ts';
import { ticketKey } from '../../native/src/protocol.ts';
import { formatUnits, parseUnits, parseCommand } from '../../native/src/commands.ts';
import { QlyphsError } from '../../provider/src/index.ts';
import type { NetworkName } from '../../native/src/network.ts';
export { formatUnits, parseUnits };
export type AccountId = string & { readonly __accountId: unique symbol };
export type AssetId = string & { readonly __assetId: unique symbol };
export type TransactionHash = string & { readonly __transactionHash: unique symbol };
export type TicketKey = string & { readonly __ticketKey: unique symbol };
function exactId(value: string, bytes: number): string {
  try {
    fromHex(value, bytes);
    return value;
  } catch {
    throw new QlyphsError(
      'INVALID_REQUEST',
      `Expected a canonical ${bytes}-byte identifier`,
      'not-submitted',
    );
  }
}
export const asAccountId = (value: string): AccountId => exactId(value, 32) as AccountId;
export const asAssetId = (value: string): AssetId => exactId(value, 40) as AssetId;
export const asTransactionHash = (value: string): TransactionHash =>
  exactId(value, 32) as TransactionHash;
export function asTicketKey(value: string): TicketKey {
  try {
    parseCommand({ kind: 'cancel', ticket: value });
    uint(BigInt(value.slice(value.indexOf(':') + 1)), 4);
    return value as TicketKey;
  } catch {
    throw new QlyphsError(
      'INVALID_REQUEST',
      'Expected a canonical reservation key',
      'not-submitted',
    );
  }
}
export const assetId = (owner: string, sequence: bigint): AssetId =>
  asAssetId(deriveAssetId(asAccountId(owner), sequence));
export const reservationKey = (multisig: string, proposal: number): TicketKey =>
  asTicketKey(ticketKey(asAccountId(multisig), proposal));
export const toBaseUnits = (value: string, decimals: number): string =>
  parseUnits(value, decimals).toString();
/** URL validation does not configure or grant access to a wallet RPC. */
export function httpBase(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new QlyphsError('INVALID_REQUEST', 'An absolute HTTP(S) base URL is required');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new QlyphsError('INVALID_REQUEST', 'Invalid HTTP(S) base URL');
  url.pathname = url.pathname.replace(/\/+$/, '') + '/';
  return url;
}
export function explorerUrl(
  baseUrl: string,
  resource: { kind: 'transaction' | 'address' | 'asset' | 'block'; id: string },
  network: NetworkName = 'development',
): string {
  const base = httpBase(baseUrl);
  if (resource.kind === 'transaction')
    return new URL(`explorer/${network}/tx/${asTransactionHash(resource.id)}`, base).href;
  const id =
    resource.kind === 'address'
      ? asAccountId(resource.id)
      : resource.kind === 'asset'
        ? asAssetId(resource.id)
        : /^(0|[1-9]\d*)$/.test(resource.id) && Number.isSafeInteger(Number(resource.id))
          ? resource.id
          : asTransactionHash(resource.id);
  const url = new URL('explorer', base);
  url.search = new URLSearchParams({
    network,
    view: resource.kind === 'asset' ? 'token' : resource.kind,
    id,
  }).toString();
  return url.href;
}
