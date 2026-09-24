import { fromHex, requireThat } from './codec.ts';
import { MAINNET } from './protocol.ts';

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
