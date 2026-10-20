/** Priority tips: the optional amount a signer adds to a transaction so the node orders it first. */
import { requireThat } from './codec.ts';

/** The levels a wallet offers, in planck (12 decimals): none, 0.01, 0.1 and 1 QTC. A node orders
 * pending transactions by tip, so any tip above zero already passes every untipped one. The tip is
 * paid even when the transaction fails, for example a lot another signer took first. */
export const TIP_LEVELS = Object.freeze([0n, 10_000_000_000n, 100_000_000_000n, 1_000_000_000_000n]);
/** The highest tip a wallet signs, a level or a custom amount: 10 QTC. It
 * stops a mistyped amount, not a deliberate one. */
export const MAX_TIP = 10_000_000_000_000n;

/** A tip as it travels in JSON: a canonical decimal string of planck, at most MAX_TIP. */
export function parseTip(value: unknown): bigint {
  requireThat(typeof value === 'string' && /^(0|[1-9]\d{0,13})$/.test(value), 'invalid tip');
  const tip = BigInt(value as string);
  requireThat(tip <= MAX_TIP, 'tip above the 10 QTC limit');
  return tip;
}

/** Creations and inscriptions are priced from one attested block: they take no tip. */
export const NO_TIP_ERROR = 'A priority tip is not offered on creations and inscriptions';
