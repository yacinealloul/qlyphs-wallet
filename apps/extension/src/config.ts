/** Endpoints are fixed at build time and cannot be supplied by a dapp. A switchable build carries
 * both networks' endpoints and pins; which one is active is the user's choice, stored by the
 * extension itself (Settings), never something a page can set. Its wallet is the same on both:
 * switching changes where the wallet reads and submits, not which keys it holds. */
import type { NetworkName, NetworkProfile } from '../../native/src/network.ts';
import { browser } from './browser.ts';
import { shareWallet, useProfile } from './profile.ts';

export interface NetworkEndpoints {
  api: string;
  rpc: string;
  dapps: readonly string[];
  explorer: string;
  profile: NetworkProfile;
  /** The development side is a public test network rather than a local one. */
  testnet?: boolean;
}

declare const QLYPHS_API: string;
declare const QLYPHS_RPC: string;
declare const QLYPHS_DAPP_ORIGINS: readonly string[];
declare const QLYPHS_EXPLORER: string;
declare const QLYPHS_VERSION: string;
declare const QLYPHS_NETWORKS: Readonly<Record<NetworkName, NetworkEndpoints>> | null | undefined;

const NETWORKS = typeof QLYPHS_NETWORKS === 'undefined' ? null : QLYPHS_NETWORKS;
/** Both networks are compiled in: the user can switch between them in Settings. */
export const SWITCHABLE = NETWORKS !== null;
if (SWITCHABLE) shareWallet([NETWORKS!.mainnet.profile, NETWORKS!.development.profile]);
/** A switchable build whose development network is a public test network: same profile and wallet
 * storage as development, named "Testnet" to the user. */
export const TESTNET = SWITCHABLE && NETWORKS!.development.testnet === true;
/** The network used until the user picks one: mainnet. */
export const DEFAULT_NETWORK: NetworkName = 'mainnet';

export let API = SWITCHABLE ? NETWORKS![DEFAULT_NETWORK].api : QLYPHS_API;
export let RPC = SWITCHABLE ? NETWORKS![DEFAULT_NETWORK].rpc : QLYPHS_RPC;
export let DAPP = new URL(API).origin;
/** Kept separate from RPC/API pins; an application cannot alter this list. */
export let DAPPS: readonly string[] = SWITCHABLE
  ? NETWORKS![DEFAULT_NETWORK].dapps
  : typeof QLYPHS_DAPP_ORIGINS === 'undefined'
    ? [DAPP]
    : Object.freeze([...QLYPHS_DAPP_ORIGINS]);
export let EXPLORER = SWITCHABLE ? NETWORKS![DEFAULT_NETWORK].explorer : QLYPHS_EXPLORER;
/** Every origin that may host the provider on any compiled network. The background still checks
 * the active network's list before it answers a page. */
export const ALL_DAPPS: readonly string[] = SWITCHABLE
  ? Object.freeze([...new Set([...NETWORKS!.development.dapps, ...NETWORKS!.mainnet.dapps])])
  : DAPPS;

export const VERSION = QLYPHS_VERSION;
export { PROFILE } from './profile.ts';

const CHOICE_KEY = 'walletNetwork';
export let NETWORK: NetworkName | null = null;

function apply(name: NetworkName): void {
  const net = NETWORKS![name];
  API = net.api;
  RPC = net.rpc;
  DAPP = new URL(net.api).origin;
  DAPPS = Object.freeze([...net.dapps]);
  EXPLORER = net.explorer;
  useProfile(net.profile);
  NETWORK = name;
}

let loading: Promise<void> | null = null;
/** Resolve the active network once per context (worker or page), before anything reads it. A fixed
 * build has nothing to load. */
export function loadNetwork(): Promise<void> {
  if (!SWITCHABLE) return Promise.resolve();
  loading ??= browser.storage.local.get(CHOICE_KEY).then((stored) => {
    const choice = stored[CHOICE_KEY];
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
