/** The network this wallet signs for. A fixed build (build.mjs QLYPHS_EXTENSION_NETWORK=development
 * or mainnet) has one, set at build time. A switchable build compiles both and the user picks one
 * in Settings (see config.ts `loadNetwork`); the values below are then assigned once at startup,
 * before anything is signed. Without the define (unit tests running src directly) it is the
 * development profile. */
import { requireThat } from '../../../packages/native/src/codec.ts';
import { MAINNET } from '../../../packages/native/src/protocol.ts';
import { DEVELOPMENT } from '../../native/src/network.ts';
import type { NetworkProfile } from '../../native/src/network.ts';
declare const QLYPHS_NETWORK_PROFILE: NetworkProfile | null | undefined;
const wrongNetwork = (mainnet: boolean) =>
  mainnet ? 'This wallet only works on Quantus mainnet' : 'Mainnet is disabled';
export let PROFILE: NetworkProfile =
  typeof QLYPHS_NETWORK_PROFILE === 'undefined' || QLYPHS_NETWORK_PROFILE === null ? DEVELOPMENT : QLYPHS_NETWORK_PROFILE;
export let MAINNET_BUILD = PROFILE.network === 'mainnet';
export let WRONG_NETWORK_ERROR = wrongNetwork(MAINNET_BUILD);
/** Switchable builds only: make `profile` the active one. Called by config.ts before first use. */
export function useProfile(profile: NetworkProfile): void {
  PROFILE = profile;
  MAINNET_BUILD = profile.network === 'mainnet';
  WRONG_NETWORK_ERROR = wrongNetwork(MAINNET_BUILD);
}
/** A vault, passkey or signing genesis belongs to the active network: never mainnet on development,
 * only the pinned mainnet genesis on mainnet. */
export const buildGenesis = (genesis: string, profile: NetworkProfile = PROFILE): boolean =>
  profile.network === 'mainnet' ? genesis === profile.genesis : genesis !== MAINNET;
export const requireBuildGenesis = (genesis: string): void => requireThat(buildGenesis(genesis), WRONG_NETWORK_ERROR);
