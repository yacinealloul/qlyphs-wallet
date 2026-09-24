/**
 * Money math (SPEC §2). Everything is bigint; decimal strings at the JSON/DB boundary. Never floats.
 *
 * - qtc amounts are planck (10^12 per QTC)
 * - usdc amounts are micro (10^6 per USDC)
 * - price is USDC micro per 1 QTC, on a 10_000 micro ($0.01) tick
 */
import {
  BPS_DENOMINATOR,
  CENT_MICRO,
  PLANCK_PER_QTC,
  PRICE_TICK_MICRO,
  QTC_DECIMALS,
  USDC_DECIMALS,
} from './constants';

export type MoneyErrorCode =
  'EMPTY' | 'INVALID_FORMAT' | 'TOO_MANY_DECIMALS' | 'NEGATIVE' | 'OUT_OF_RANGE';

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;

  constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}

/** Upper bound on integer digits accepted from user input; far above any real supply. */
const MAX_INTEGER_DIGITS = 30;
const DECIMAL_RE = /^(\d+)(?:\.(\d*))?$|^\.(\d+)$/;
const INTEGER_RE = /^(0|[1-9]\d*)$/;

const pow10 = (n: number): bigint => 10n ** BigInt(n);

/**
 * Parse a non-negative decimal string ("12", "12.5", ".5") into base units.
 * Rejects signs, exponents, separators ("1,5" is ambiguous across locales) and more fractional
 * digits than `decimals` (no silent rounding).
 */
export function parseUnits(input: string, decimals: number): bigint {
  const cleaned = input.trim();
  if (cleaned === '') throw new MoneyError('EMPTY', 'Amount is empty');
  if (cleaned.startsWith('-')) throw new MoneyError('NEGATIVE', 'Amount cannot be negative');
  const match = DECIMAL_RE.exec(cleaned);
  if (!match) throw new MoneyError('INVALID_FORMAT', `"${input}" is not a decimal number`);
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? match[3] ?? '';
  if (whole.replace(/^0+/, '').length > MAX_INTEGER_DIGITS) {
    throw new MoneyError('OUT_OF_RANGE', 'Amount is too large');
  }
  const significantFraction = fraction.replace(/0+$/, '');
  if (significantFraction.length > decimals) {
    throw new MoneyError('TOO_MANY_DECIMALS', `At most ${decimals} decimal places are allowed`);
  }
  return BigInt(whole) * pow10(decimals) + BigInt(significantFraction.padEnd(decimals, '0') || '0');
}

/** Like {@link parseUnits} but returns `null` instead of throwing. */
export function tryParseUnits(input: string, decimals: number): bigint | null {
  try {
    return parseUnits(input, decimals);
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

export interface FormatOptions {
  /** Pad the fraction with zeros up to this many digits. Default 0. */
  minFractionDigits?: number;
  /** Cut the fraction to this many digits. Default: all significant digits. */
  maxFractionDigits?: number;
  /** How to cut when `maxFractionDigits` drops digits. Default `floor` (never overstates a balance). */
  rounding?: 'floor' | 'halfUp';
  /** Insert `,` thousands separators in the integer part. Default false (machine-readable). */
  grouping?: boolean;
}

/** Format base units as a decimal string. Exact by default; the output round-trips through `parseUnits`. */
export function formatUnits(value: bigint, decimals: number, options: FormatOptions = {}): string {
  const { minFractionDigits = 0, grouping = false, rounding = 'floor' } = options;
  const maxFractionDigits = Math.min(options.maxFractionDigits ?? decimals, decimals);
  if (minFractionDigits > maxFractionDigits) {
    throw new RangeError('minFractionDigits cannot exceed maxFractionDigits');
  }
  const negative = value < 0n;
  let abs = negative ? -value : value;

  const dropped = decimals - maxFractionDigits;
  if (dropped > 0) {
    const unit = pow10(dropped);
    abs = rounding === 'halfUp' ? (abs + unit / 2n) / unit : abs / unit;
  }
  const scale = pow10(maxFractionDigits);
  const whole = (abs / scale).toString();
  let fraction =
    maxFractionDigits === 0 ? '' : (abs % scale).toString().padStart(maxFractionDigits, '0');
  fraction = fraction.replace(/0+$/, '').padEnd(minFractionDigits, '0');

  const wholeOut = grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;
  const sign = negative && abs !== 0n ? '-' : '';
  return fraction === '' ? `${sign}${wholeOut}` : `${sign}${wholeOut}.${fraction}`;
}

export const parseQtc = (input: string): bigint => parseUnits(input, QTC_DECIMALS);
export const parseUsdc = (input: string): bigint => parseUnits(input, USDC_DECIMALS);

/** Parse a price typed in USDC per QTC (e.g. "28.40"). Throws if it is not on the $0.01 tick or is zero. */
export function parsePrice(input: string): bigint {
  const price = parseUnits(input, USDC_DECIMALS);
  if (!isValidPrice(price)) {
    throw new MoneyError(
      price === 0n ? 'OUT_OF_RANGE' : 'TOO_MANY_DECIMALS',
      'Price must be positive with at most 2 decimal places',
    );
  }
  return price;
}

export const formatQtc = (planck: bigint, options?: FormatOptions): string =>
  formatUnits(planck, QTC_DECIMALS, options);

/** USDC, 2 decimals minimum so totals read as money ("1420.00"). */
export const formatUsdc = (micro: bigint, options?: FormatOptions): string =>
  formatUnits(micro, USDC_DECIMALS, { minFractionDigits: 2, ...options });

export const formatPrice = (price: bigint, options?: FormatOptions): string =>
  formatUnits(price, USDC_DECIMALS, { minFractionDigits: 2, maxFractionDigits: 2, ...options });

/** Decode a base-unit integer string from JSON/DB ("1000000000000"). */
export function fromBaseUnitString(input: string): bigint {
  if (!INTEGER_RE.test(input)) {
    throw new MoneyError('INVALID_FORMAT', `"${input}" is not a base-unit integer string`);
  }
  return BigInt(input);
}

/** Encode a non-negative bigint for JSON/DB. */
export function toBaseUnitString(value: bigint): string {
  if (value < 0n) throw new MoneyError('NEGATIVE', 'Amount cannot be negative');
  return value.toString();
}

export const isOnTick = (price: bigint): boolean => price % PRICE_TICK_MICRO === 0n;
export const isValidPrice = (price: bigint): boolean => price > 0n && isOnTick(price);

/** `round(numerator / denominator)`, ties away from zero. Operands must be non-negative. */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  if (numerator < 0n) throw new MoneyError('NEGATIVE', 'numerator cannot be negative');
  return (numerator + denominator / 2n) / denominator;
}

/**
 * USDC micro the buyer pays for `amountPlanck` at `price`:
 * `roundHalfUp(amount * price / 10^12)` to the cent. The buyer pays exactly this.
 */
export function quoteTotal(amountPlanck: bigint, price: bigint): bigint {
  if (amountPlanck < 0n) throw new MoneyError('NEGATIVE', 'amount cannot be negative');
  if (price < 0n) throw new MoneyError('NEGATIVE', 'price cannot be negative');
  const cents = divRoundHalfUp(amountPlanck * price, PLANCK_PER_QTC * CENT_MICRO);
  return cents * CENT_MICRO;
}

/** Platform fee on the QTC leg, floored: `amount * feeBps / 10_000`. */
export function feeFor(amountPlanck: bigint, feeBps: number | bigint): bigint {
  if (typeof feeBps === 'number' && !Number.isInteger(feeBps)) {
    throw new MoneyError('INVALID_FORMAT', 'feeBps must be an integer');
  }
  const bps = BigInt(feeBps);
  if (amountPlanck < 0n) throw new MoneyError('NEGATIVE', 'amount cannot be negative');
  if (bps < 0n || bps > BPS_DENOMINATOR) {
    throw new MoneyError('OUT_OF_RANGE', 'feeBps must be within 0..10000');
  }
  return (amountPlanck * bps) / BPS_DENOMINATOR;
}

/** What the buyer receives at release: `amount - fee`. */
export const buyerReceives = (amountPlanck: bigint, feeBps: number | bigint): bigint =>
  amountPlanck - feeFor(amountPlanck, feeBps);

export interface TradeAmounts {
  amount: bigint;
  price: bigint;
  quoteTotal: bigint;
  fee: bigint;
  buyerReceives: bigint;
}

/** All derived amounts of a fill, computed once at match and snapshotted on the trade. */
export function tradeAmounts(
  amountPlanck: bigint,
  price: bigint,
  feeBps: number | bigint,
): TradeAmounts {
  const fee = feeFor(amountPlanck, feeBps);
  return {
    amount: amountPlanck,
    price,
    quoteTotal: quoteTotal(amountPlanck, price),
    fee,
    buyerReceives: amountPlanck - fee,
  };
}

/**
 * SPEC §3b: what a custodial wallet can commit. The existential deposit keeps the account alive
 * and the fee reserve pays for one lock and one withdrawal. Never negative.
 */
export function availableBalance(p: {
  onChain: bigint;
  existentialDeposit: bigint;
  feeReserve: bigint;
}): bigint {
  const left = p.onChain - p.existentialDeposit - p.feeReserve;
  return left > 0n ? left : 0n;
}

/** `available` minus what the database already promised elsewhere. Never negative. */
export function spendableBalance(available: bigint, reserved: bigint): bigint {
  const left = available - reserved;
  return left > 0n ? left : 0n;
}

export type FillErrorCode =
  'AMOUNT_NOT_POSITIVE' | 'EXCEEDS_REMAINING' | 'BELOW_MIN_FILL' | 'LEAVES_DUST';

export type FillCheck = { ok: true } | { ok: false; code: FillErrorCode; message: string };

/**
 * Validate a (partial) fill against an offer. A fill must be ≥ `minFill` unless it takes the whole
 * remainder, and must not leave a remainder smaller than `minFill` that nobody could take.
 */
export function checkFill(p: { amount: bigint; remaining: bigint; minFill: bigint }): FillCheck {
  const { amount, remaining, minFill } = p;
  if (amount <= 0n) {
    return { ok: false, code: 'AMOUNT_NOT_POSITIVE', message: 'Amount must be greater than zero' };
  }
  if (amount > remaining) {
    return {
      ok: false,
      code: 'EXCEEDS_REMAINING',
      message: 'Amount exceeds what is left on the offer',
    };
  }
  if (amount === remaining) return { ok: true };
  if (amount < minFill) {
    return { ok: false, code: 'BELOW_MIN_FILL', message: 'Amount is below the minimum fill' };
  }
  if (remaining - amount < minFill) {
    return {
      ok: false,
      code: 'LEAVES_DUST',
      message: 'Fill would leave less than the minimum fill; take the full remainder instead',
    };
  }
  return { ok: true };
}

/** Signed change from `from` to `to` in basis points, truncated toward zero. `null` when `from` is 0. */
export function changeBps(from: bigint, to: bigint): number | null {
  if (from <= 0n) return null;
  return Number(((to - from) * BPS_DENOMINATOR) / from);
}
