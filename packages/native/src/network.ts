import { fromHex, requireThat } from './codec.ts';
import { checkRules, LEGACY_RULES, MAINNET, mainnetRules } from './protocol.ts';
import type { Rules } from './protocol.ts';
import { checkFeeRules } from './fee-schedule.ts';
import type { FeeRules } from './fee-schedule.ts';

/** Fingerprint of the only development runtime supported by this alpha. */
export const DEV_RUNTIME_HASH =
  '0xe2e37391ee730603d0c66dfbff9dafe9badc5dbc2caa7e151231e590c04ee820';

export type NetworkName = 'development' | 'mainnet';
/** The runtime a build signs for. Any other runtime disables signing until revalidated. */
export interface RuntimePin {
  specVersion: number;
  transactionVersion: number;
  codeHash: string;
}
export interface Manifest {
  format: 1;
  genesis: string;
  activation: { height: number; hash: string };
  runtimeHash: string;
  network: NetworkName;
}
export interface SigningContext {
  genesisHash: string;
  specVersion: number;
  transactionVersion: number;
  nonce: number;
  tip: string;
  period: number;
  blockNumber: number;
  blockHash: string;
}

/** What a service or wallet build accepts. Development takes whatever dev chain it meets (genesis
 * and activation come from the node); mainnet takes nothing it was not built with. */
export type NetworkProfile =
  | { network: 'development'; runtime: RuntimePin }
  | {
      network: 'mainnet';
      runtime: RuntimePin;
      genesis: string;
      activation: { height: number; hash: string };
    };

export const DEV_RUNTIME: RuntimePin = {
  specVersion: 152,
  transactionVersion: 6,
  codeHash: DEV_RUNTIME_HASH,
};
export const DEVELOPMENT: NetworkProfile = { network: 'development', runtime: DEV_RUNTIME };

/** How many blocks below the best one a mainnet block counts as final. The node's own finality is
 * 100 blocks deep; observed mainnet reorganizations never went past 2. The indexer, the witnesses
 * and the wallets all use this depth, and stop rather than follow a deeper reorganization.
 * Development keeps the node's finality. */
export const MAINNET_FINALITY_DEPTH = 20;
export const finalityDepth = (network: NetworkName): number | null =>
  network === 'mainnet' ? MAINNET_FINALITY_DEPTH : null;
/** The height that counts as final: the node's finalized block, or `depth` below the best one when
 * that is newer. */
export function finalHeight(best: number, nodeFinalized: number, depth: number | null): number {
  requireThat(
    Number.isSafeInteger(best) && Number.isSafeInteger(nodeFinalized) && 0 <= nodeFinalized && nodeFinalized <= best,
    'invalid chain heads',
  );
  return depth === null ? nodeFinalized : Math.max(nodeFinalized, best - depth);
}

const hash32 = (value: unknown, what: string): string => {
  requireThat(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value), `invalid ${what}`);
  fromHex(value as string, 32);
  return value as string;
};
const int = (value: unknown, what: string, min: number): number => {
  requireThat(Number.isSafeInteger(value) && (value as number) >= min, `invalid ${what}`);
  return value as number;
};

/** The mainnet lock. QLYP reads Quantus mainnet only from an activation block after genesis, and
 * signs only for the runtime it was checked against (apps/native/scripts/mainnet-compat.mjs).
 * There is no default: a build or service without these pins stays on the development network. */
export function mainnetProfile(pins: unknown): NetworkProfile {
  requireThat(pins !== null && typeof pins === 'object', 'mainnet pins required');
  const p = pins as Record<string, unknown>;
  const runtime = p.runtime as Record<string, unknown> | undefined;
  const activation = p.activation as Record<string, unknown> | undefined;
  requireThat(runtime !== null && typeof runtime === 'object', 'mainnet runtime pin required');
  requireThat(
    activation !== null && typeof activation === 'object',
    'mainnet activation pin required',
  );
  requireThat(p.genesis === MAINNET, 'pins are not for Quantus mainnet');
  return {
    network: 'mainnet',
    genesis: MAINNET,
    runtime: {
      specVersion: int(runtime!.specVersion, 'runtime specVersion', 1),
      transactionVersion: int(runtime!.transactionVersion, 'runtime transactionVersion', 1),
      codeHash: hash32(runtime!.codeHash, 'runtime code hash'),
    },
    // Height 0 would reinterpret mainnet history from before QLYP existed.
    activation: {
      height: int(activation!.height, 'activation height', 1),
      hash: hash32(activation!.hash, 'activation hash'),
    },
  };
}

/** The configured fee schedule (NATIVE_FEE_SCHEDULE): strict JSON of a fee schedule, or unset for
 * none. Mainnet takes its schedule from the reviewed release only, so any value is refused. */
export function feeScheduleInput(network: NetworkName, raw: string | undefined): FeeRules | null {
  if (raw === undefined || raw === '') return null;
  requireThat(
    network === 'development',
    'mainnet takes its fee schedule from the reviewed release only',
  );
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('invalid fee schedule');
  }
  return value === null ? null : checkFeeRules(value);
}

/** The rules for the configured activations: NATIVE_PROGRESSIVE_FROM (progressive-1000-v1, tag
 * 11), NATIVE_PROGRESSIVE_V2_FROM (progressive-1000-v2, tag 12) and NATIVE_FEE_SCHEDULE. An absent
 * height keeps its tag an unknown operation. Mainnet has no reviewed activation, so any value is
 * refused. */
export function progressiveRules(
  network: NetworkName,
  from: string | undefined,
  fromV2: string | undefined,
  fees: string | undefined,
): Rules {
  const height = (v: string | undefined, name: string) => {
    if (v === undefined || v === '') return null;
    requireThat(network === 'development', 'progressive mint has no reviewed mainnet activation');
    requireThat(/^[1-9][0-9]{0,9}$/.test(v), `invalid ${name} activation height`);
    return { from: Number(v) };
  };
  const rules = {
    progressive: height(from, 'progressive'),
    progressiveV2: height(fromV2, 'progressive v2'),
    feeSchedule: feeScheduleInput(network, fees),
  };
  return rules.progressive === null && rules.progressiveV2 === null && rules.feeSchedule === null
    ? LEGACY_RULES
    : checkRules(rules);
}

/** The rules a service or witness of `profile` runs. Development takes the configured activations;
 * mainnet runs only the reviewed ones (mainnetRules), and refuses any value configured for it. */
export function profileRules(
  profile: NetworkProfile,
  from: string | undefined,
  fromV2: string | undefined,
  fees: string | undefined,
): Rules {
  if (profile.network === 'development') return progressiveRules('development', from, fromV2, fees);
  requireThat(
    !from && !fromV2,
    'mainnet takes progressive activations from the reviewed release only',
  );
  feeScheduleInput('mainnet', fees);
  return mainnetRules();
}

/** A manifest as a service or wallet of this profile must see it. */
export function checkManifest(m: Manifest, profile: NetworkProfile): void {
  requireThat(
    m.format === 1 && m.network === profile.network && m.runtimeHash === profile.runtime.codeHash,
    'unexpected network manifest',
  );
  hash32(m.genesis, 'genesis');
  hash32(m.activation.hash, 'activation hash');
  if (profile.network === 'development')
    requireThat(
      m.genesis !== MAINNET && m.activation.height === 0 && m.activation.hash === m.genesis,
      'development manifest required',
    );
  else
    requireThat(
      m.genesis === profile.genesis &&
        m.activation.height === profile.activation.height &&
        m.activation.hash === profile.activation.hash,
      'mainnet manifest differs from the pinned activation',
    );
}
