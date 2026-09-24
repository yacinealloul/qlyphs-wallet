import type { Manifest } from '../../native/src/network.ts';

// Browser storage may reorder object keys. Network identity is defined by values,
// while unknown fields still require an explicit format upgrade.
export function sameNetwork(a: Manifest, b: Manifest): boolean {
  const shape = (m: Manifest) =>
    !!m &&
    Object.keys(m).sort().join(',') === 'activation,format,genesis,network,runtimeHash' &&
    !!m.activation &&
    Object.keys(m.activation).sort().join(',') === 'hash,height';
  return (
    shape(a) &&
    shape(b) &&
    a.format === b.format &&
    a.genesis === b.genesis &&
    a.network === b.network &&
    a.runtimeHash === b.runtimeHash &&
    a.activation.height === b.activation.height &&
    a.activation.hash === b.activation.hash
  );
}
