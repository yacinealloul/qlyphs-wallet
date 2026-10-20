/** Endpoints are fixed at build time and cannot be supplied by a dapp. A switchable build carries
 * both networks' endpoints and pins; which one is active is the user's choice, stored by the
 * extension itself (Settings), never something a page can set. Its wallet is the same on both:
 * switching changes where the wallet reads and submits, not which keys it holds. */
import type { NetworkName, NetworkProfile } from '../../native/src/network.ts';
import { browser } from './browser.ts';
import { PROFILE, shareWallet, useProfile } from './profile.ts';
import { checkEndpoints, ENDPOINTS_KEY } from './endpoints.ts';
import type { Endpoints } from './endpoints.ts';

export interface NetworkEndpoints {
  api: string;
  rpc: string;
  /** A second node for the same chain, used only when `rpc` cannot be reached at all. */
  rpcFallback?: string;
  dapps: readonly string[];
  /** The Qlyphs app, one of `dapps`: token logos are read from it and its token pages opened. */
  platform: string;
  explorer: string;
  profile: NetworkProfile;
  /** The development side is a public test network rather than a local one. */
  testnet?: boolean;
}

declare const QLYPHS_API: string;
declare const QLYPHS_RPC: string;
declare const QLYPHS_RPC_FALLBACK: string | null | undefined;
declare const QLYPHS_DAPP_ORIGINS: readonly string[];
declare const QLYPHS_EXPLORER: string;
declare const QLYPHS_PLATFORM: string | undefined;
declare const QLYPHS_VERSION: string;
declare const QLYPHS_NETWORKS: Readonly<Record<NetworkName, NetworkEndpoints>> | null | undefined;
declare const QLYPHS_CUSTOM_ENDPOINTS: boolean | undefined;
declare const QLYPHS_SOLANA_VAULT: boolean | undefined;

const NETWORKS = typeof QLYPHS_NETWORKS === 'undefined' ? null : QLYPHS_NETWORKS;
/** Both networks are compiled in: the user can switch between them in Settings. */
export const SWITCHABLE = NETWORKS !== null;
if (SWITCHABLE) shareWallet([NETWORKS!.mainnet.profile, NETWORKS!.development.profile]);
/** A switchable build whose development network is a public test network: same profile and wallet
 * storage as development, named "Testnet" to the user. */
export const TESTNET = SWITCHABLE && NETWORKS!.development.testnet === true;
/** A development build: its test network runs on this machine, so custom endpoints may too. */
export const LOCAL_NETWORK = !TESTNET;
/** The user may set endpoints (Settings → Network): development builds only, the one kind whose CSP
 * lets the wallet reach a host it was not built with. */
export const CUSTOM_ENDPOINTS = typeof QLYPHS_CUSTOM_ENDPOINTS === 'boolean' && QLYPHS_CUSTOM_ENDPOINTS;
/** The network used until the user picks one: mainnet. */
export const DEFAULT_NETWORK: NetworkName = 'mainnet';

export let API = SWITCHABLE ? NETWORKS![DEFAULT_NETWORK].api : QLYPHS_API;
export let RPC = SWITCHABLE ? NETWORKS![DEFAULT_NETWORK].rpc : QLYPHS_RPC;
/** Reached only when RPC fails at the network level (unreachable, blocked, no CORS answer). Every
 * read through it passes the same genesis, runtime and checkpoint pins as RPC. */
export let RPC_FALLBACK: string | null = SWITCHABLE
  ? (NETWORKS![DEFAULT_NETWORK].rpcFallback ?? null)
  : typeof QLYPHS_RPC_FALLBACK === 'string'
    ? QLYPHS_RPC_FALLBACK
    : null;
export let DAPP = new URL(API).origin;
/** Kept separate from RPC/API pins; an application cannot alter this list. */
export let DAPPS: readonly string[] = SWITCHABLE
  ? NETWORKS![DEFAULT_NETWORK].dapps
  : typeof QLYPHS_DAPP_ORIGINS === 'undefined'
    ? [DAPP]
    : Object.freeze([...QLYPHS_DAPP_ORIGINS]);
export let EXPLORER = SWITCHABLE ? NETWORKS![DEFAULT_NETWORK].explorer : QLYPHS_EXPLORER;
export let PLATFORM = SWITCHABLE
  ? NETWORKS![DEFAULT_NETWORK].platform
  : typeof QLYPHS_PLATFORM === 'string'
    ? QLYPHS_PLATFORM
    : DAPPS[0]!;
/** Every origin that may host the provider on any compiled network. The background still checks
 * the active network's list before it answers a page. */
export const ALL_DAPPS: readonly string[] = SWITCHABLE
  ? Object.freeze([...new Set([...NETWORKS!.development.dapps, ...NETWORKS!.mainnet.dapps])])
  : DAPPS;

export const VERSION = QLYPHS_VERSION;
/** Solana vault signing (packages/provider/src/solana-vault.ts): compiled on only in the fixed
 * development build. Mainnet, switchable and testnet builds, and anything without the define, have
 * no such methods. */
export const SOLANA_VAULT = typeof QLYPHS_SOLANA_VAULT !== 'undefined' && QLYPHS_SOLANA_VAULT === true;
export { PROFILE } from './profile.ts';

const CHOICE_KEY = 'walletNetwork';
export let NETWORK: NetworkName | null = null;

/** The compiled endpoints of a network, before any the user set. */
const COMPILED = SWITCHABLE
  ? null
  : { api: QLYPHS_API, rpc: QLYPHS_RPC, rpcFallback: RPC_FALLBACK, explorer: QLYPHS_EXPLORER };
/** Endpoints the user set, by network (endpoints.ts). Read with the network choice. */
let custom: Partial<Record<NetworkName, Endpoints>> = {};
/** The network whose endpoints are in use: the chosen one, or the build's only one. */
const activeName = (): NetworkName => NETWORK ?? PROFILE.network;
export const defaultEndpoints = (name: NetworkName = activeName()) => {
  const base = SWITCHABLE ? NETWORKS![name] : COMPILED!;
  return { rpc: base.rpc, api: base.api, explorer: base.explorer };
};
export const customEndpoints = (name: NetworkName = activeName()): Endpoints => ({ ...custom[name] });

function apply(name: NetworkName): void {
  const net = SWITCHABLE ? NETWORKS![name] : { ...COMPILED!, dapps: DAPPS, platform: PLATFORM, profile: PROFILE };
  const own = custom[name] ?? {};
  API = own.api ?? net.api;
  RPC = own.rpc ?? net.rpc;
  // A node the user named replaces the compiled pair: no silent fallback to another node.
  RPC_FALLBACK = own.rpc ? null : (net.rpcFallback ?? null);
  DAPP = new URL(net.api).origin;
  DAPPS = Object.freeze([...net.dapps]);
  EXPLORER = own.explorer ?? net.explorer;
  PLATFORM = net.platform;
  if (SWITCHABLE) {
    useProfile(net.profile);
    NETWORK = name;
  }
}
async function readCustom(): Promise<void> {
  // A context without storage (a preview, a test page) uses the compiled endpoints.
  const stored = (await Promise.resolve()
    .then(() => browser.storage.local.get(ENDPOINTS_KEY))
    .then((items) => items[ENDPOINTS_KEY])
    .catch(() => undefined)) as Partial<Record<NetworkName, unknown>> | undefined;
  custom = {};
  // Endpoints stored by a build that allowed them are ignored by one that cannot reach them.
  if (!CUSTOM_ENDPOINTS) return;
  for (const name of ['mainnet', 'development'] as const)
    try {
      if (stored?.[name]) custom[name] = checkEndpoints(name, stored[name], LOCAL_NETWORK);
    } catch {
      // A stored value this build no longer accepts is ignored: the compiled endpoints apply.
    }
}
/** Store the endpoints a network uses (`null`: back to the compiled ones) and apply them here. */
export async function setEndpoints(name: NetworkName, endpoints: Endpoints | null): Promise<void> {
  const next = { ...custom };
  if (endpoints && Object.keys(endpoints).length) next[name] = endpoints;
  else delete next[name];
  await browser.storage.local.set({ [ENDPOINTS_KEY]: next });
  custom = next;
  if (name === activeName()) apply(name);
}
/** The node and indexer a network would use with these endpoints, to probe them before they are
 * stored. Nothing changes here: reads go on to the endpoints in use. */
export function probeEndpoints(name: NetworkName, endpoints: Endpoints | null): { api: string; rpc: string } {
  const base = defaultEndpoints(name);
  return { api: endpoints?.api ?? base.api, rpc: endpoints?.rpc ?? base.rpc };
}
/** Another context changed the endpoints: read them again (pages follow the background). */
export async function reloadEndpoints(): Promise<void> {
  await readCustom();
  apply(activeName());
}

let loading: Promise<void> | null = null;
/** Resolve the active network once per context (worker or page), before anything reads it. A fixed
 * build has nothing to load. */
export function loadNetwork(): Promise<void> {
  loading ??= readCustom().then(async () => {
    if (!SWITCHABLE) return apply(PROFILE.network);
    const choice = (await browser.storage.local.get(CHOICE_KEY))[CHOICE_KEY];
    apply(choice === 'development' || choice === 'mainnet' ? choice : DEFAULT_NETWORK);
  });
  return loading;
}

/** A compiled network's profile (switchable builds only). */
export const profileOf = (name: NetworkName): NetworkProfile => NETWORKS![name].profile;

/** Store the user's choice and make it active in this context. The background then moves the
 * wallet to that network's pinned manifest; extension pages reload to pick it up. */
export async function switchNetwork(name: NetworkName): Promise<void> {
  if (!SWITCHABLE) throw Error('This build has a single network');
  await browser.storage.local.set({ [CHOICE_KEY]: name });
  useNetwork(name);
}
/** Make `name` active in this context only: an extension page follows the background's switch
 * without storing anything or reloading. */
export function useNetwork(name: NetworkName): void {
  if (!SWITCHABLE) throw Error('This build has a single network');
  apply(name);
  loading = Promise.resolve();
}
