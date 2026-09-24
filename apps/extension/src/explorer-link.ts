import { PROFILE } from './profile.ts';
import type { NetworkName } from '../../native/src/network.ts';
/** Public web explorer, on the network this build signs for. */
export function explorerURL(base: string, hash?: string, network: NetworkName = PROFILE.network): string {
  const url = new URL(base);
  if (hash !== undefined) {
    if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw Error('Invalid transaction hash');
    url.pathname = url.pathname.replace(/\/$/, '') + '/' + network + '/tx/' + hash.toLowerCase();
    url.search = '';
  } else url.searchParams.set('network', network);
  url.hash = '';
  return url.href;
}
