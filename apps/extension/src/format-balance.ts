/** Display-only rounding; transaction amounts always retain their base-unit precision. */
export function formatBalance(value: bigint, decimals: number): string {
  if (value < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 38)
    throw new RangeError('Invalid balance');
  const precision = Math.min(decimals, 3);
  const divisor = 10n ** BigInt(decimals - precision);
  const rounded = (value + divisor / 2n) / divisor;
  if (value > 0n && rounded === 0n) return '<0.001';
  const digits = rounded.toString().padStart(precision + 1, '0');
  if (!precision) return digits;
  const fraction = digits.slice(-precision).replace(/0+$/, '');
  return digits.slice(0, -precision) + (fraction ? '.' + fraction : '');
}
