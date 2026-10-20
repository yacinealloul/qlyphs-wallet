/** Endpoints the user sets in place of a network's compiled ones (Settings → Network → Edit).
 * Mainnet takes a node only: every read through it is still proven against the compiled genesis,
 * runtime and checkpoint pins (network.ts), so a node cannot move the wallet to another chain.
 * A test network also takes an indexer and an explorer over HTTPS; only a development build, whose
 * own network runs on this machine, also accepts loopback HTTP. */
import type { NetworkName } from '../../native/src/network.ts';

export interface Endpoints {
  rpc?: string;
  api?: string;
  explorer?: string;
}
/** Storage key: `{ mainnet?: Endpoints; development?: Endpoints }`. */
export const ENDPOINTS_KEY = 'walletEndpoints';
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];

function url(value: unknown, what: string, loopback: boolean, origin: boolean): string {
  if (typeof value !== 'string' || value.length > 200) throw Error(`Enter a valid ${what} URL`);
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    throw Error(`Enter a valid ${what} URL`);
  }
  const here = u.protocol === 'http:' && LOOPBACK.includes(u.hostname);
  if (!(u.protocol === 'https:' || (loopback && here)))
    throw Error(loopback ? `The ${what} must use HTTPS, or run on this machine` : `The ${what} must use HTTPS`);
  if (u.username || u.password || u.search || u.hash) throw Error(`The ${what} URL takes no credentials, query or fragment`);
  if (origin && u.pathname !== '/') throw Error(`The ${what} is an origin only, like https://node.example`);
  return origin ? u.origin : u.href.replace(/\/$/, '');
}

/** Every refusal this module and the background's endpoint change can show: fixed wording only. */
export const ENDPOINT_ERRORS: readonly string[] = [
  'Invalid endpoints',
  'On mainnet only the node can change',
  'Unknown network',
  'This wallet cannot change its endpoints',
  'Finish the current operation first',
  'Allow Qlyphs to reach this address first',
  ...['node', 'indexer', 'explorer'].flatMap((what) => [
    `Enter a valid ${what} URL`,
    `The ${what} must use HTTPS, or run on this machine`,
    `The ${what} must use HTTPS`,
    `The ${what} URL takes no credentials, query or fragment`,
    `The ${what} is an origin only, like https://node.example`,
  ]),
];

/** The endpoints a network may take, checked; empty values keep the compiled ones. `local`: a
 * development build, whose test network may run on this machine. */
export function checkEndpoints(network: NetworkName, value: unknown, local = false): Endpoints {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error('Invalid endpoints');
  const v = value as Record<string, unknown>;
  const allowed = network === 'mainnet' ? ['rpc'] : ['rpc', 'api', 'explorer'];
  for (const key of Object.keys(v))
    if (!allowed.includes(key)) throw Error(network === 'mainnet' ? 'On mainnet only the node can change' : 'Invalid endpoints');
  const loopback = network !== 'mainnet' && local;
  const out: Endpoints = {};
  if (v.rpc) out.rpc = url(v.rpc, 'node', loopback, true);
  if (v.api) out.api = url(v.api, 'indexer', loopback, true);
  if (v.explorer) out.explorer = url(v.explorer, 'explorer', loopback, false);
  return out;
}

/** Host patterns the browser must allow before the wallet can reach these endpoints. */
export function hostPatterns(endpoints: Endpoints): string[] {
  return [
    ...new Set(
      [endpoints.rpc, endpoints.api]
        .filter((v): v is string => !!v)
        .map((v) => {
          const u = new URL(v);
          return `${u.protocol}//${u.hostname}/*`;
        }),
    ),
  ];
}
