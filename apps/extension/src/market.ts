/** A token's recent prices from its trades on Qlyphs, sales between accounts and lot mints, each at
 * what was paid per whole token. Display only: no price read here reaches a review or a signature. */

/** One trade: when it happened (ms), what was paid (planck) for how many base units. */
export interface Trade {
  time: number;
  price: string;
  amount: string;
  kind: 'sale' | 'mint';
}

const PLANCK = /^(0|[1-9]\d{0,38})$/;
const UNITS = /^[1-9]\d{0,38}$/;
/** Each indexer answer lists at most 50 entries; anything beyond is not read. */
const MAX_ENTRIES = 200;

function entries(answer: unknown, key: string): unknown[] {
  const list = answer && typeof answer === 'object' ? (answer as Record<string, unknown>)[key] : undefined;
  return Array.isArray(list) ? list.slice(0, MAX_ENTRIES) : [];
}

/** The trades of `asset` in the indexer's sales and activity answers, newest first. Anything
 * malformed or about another asset is left out. Accepted mints count as purchases at their lot's
 * price, as the Qlyphs app counts them. */
export function readTrades(asset: string, sales: unknown, activity: unknown): Trade[] {
  const out: Trade[] = [];
  const take = (entry: unknown, kind: Trade['kind']) => {
    if (!entry || typeof entry !== 'object') return;
    const e = entry as Record<string, unknown>;
    if (
      e.asset === asset &&
      typeof e.price === 'string' &&
      PLANCK.test(e.price) &&
      typeof e.amount === 'string' &&
      UNITS.test(e.amount) &&
      Number.isSafeInteger(e.time) &&
      (e.time as number) > 0
    )
      out.push({ time: e.time as number, price: e.price, amount: e.amount, kind });
  };
  for (const sale of entries(sales, 'sales')) take(sale, 'sale');
  for (const item of entries(activity, 'items')) {
    const e = item as Record<string, unknown> | null;
    if (e && e.kind === 'mint' && e.success === true && e.verdict === 'accepted') take(item, 'mint');
  }
  return out.sort((a, b) => b.time - a.time);
}

/** Planck per whole token. */
export const unitPrice = (trade: Trade, decimals: number): bigint =>
  (BigInt(trade.price) * 10n ** BigInt(decimals)) / BigInt(trade.amount);

export const RANGES = [
  ['1D', 86_400_000],
  ['1W', 7 * 86_400_000],
  ['1M', 30 * 86_400_000],
  ['All', Infinity],
] as const;
export type Range = (typeof RANGES)[number][0];

export interface MarketView {
  /** The last trade's price, planck per whole token. */
  price: bigint;
  /** Percent change over the range, from the price in force when it began; null with one price. */
  change: number | null;
  /** Oldest first, ending at `now` with the last price. */
  points: { time: number; price: bigint }[];
}

/** The price over one range: the trades in it, starting from the price in force when it began (or
 * from its first trade), and carried to `now`. */
export function marketView(trades: readonly Trade[], decimals: number, range: Range, now: number): MarketView | null {
  if (!trades.length) return null;
  const span = RANGES.find(([r]) => r === range)![1];
  const from = now - span;
  const oldest = [...trades].reverse();
  const before = oldest.filter((t) => t.time < from).at(-1);
  const points = [
    ...(before ? [{ time: from, price: unitPrice(before, decimals) }] : []),
    ...oldest.filter((t) => t.time >= from).map((t) => ({ time: t.time, price: unitPrice(t, decimals) })),
  ];
  const price = unitPrice(trades[0]!, decimals);
  points.push({ time: Math.max(now, points.at(-1)!.time), price });
  const start = points[0]!.price;
  const moved = points.length > 2 || before !== undefined;
  const change = moved && start > 0n ? Number(((price - start) * 1_000_000n) / start) / 10_000 : null;
  return { price, change, points };
}

/** The shortest range with at least two trades, so the chart has a line; else every trade. */
export function defaultRange(trades: readonly Trade[], now: number): Range {
  for (const [range, span] of RANGES) if (trades.filter((t) => t.time >= now - span).length >= 2) return range;
  return 'All';
}

/** A price with four significant digits, in QTC. */
export function formatPrice(planck: bigint): string {
  if (planck <= 0n) return '0 QTC';
  const drop = Math.max(0, planck.toString().length - 4);
  const step = 10n ** BigInt(drop);
  const rounded = ((planck + step / 2n) / step) * step;
  const whole = rounded / 10n ** 12n;
  const fraction = (rounded % 10n ** 12n).toString().padStart(12, '0').replace(/0+$/, '');
  return whole.toLocaleString('en-US') + (fraction ? '.' + fraction : '') + ' QTC';
}

/** An SVG path through the points over a `width` × `height` box, and the area under it. Trades draw
 * a step line (each price holds until the next trade); a market feed, a plain line. */
export function chartPaths(
  points: readonly { time: number; price: bigint | number }[],
  width: number,
  height: number,
  step = true,
) {
  const times = points.map((p) => p.time),
    prices = points.map((p) => Number(p.price));
  const t0 = Math.min(...times),
    t1 = Math.max(...times);
  let low = Math.min(...prices),
    high = Math.max(...prices);
  // A flat price sits mid-height.
  if (high === low) {
    low -= 1;
    high += 1;
  }
  const pad = 4;
  const x = (t: number) => (t1 === t0 ? width : ((t - t0) / (t1 - t0)) * width).toFixed(1);
  const y = (p: number) => (pad + (1 - (p - low) / (high - low)) * (height - 2 * pad)).toFixed(1);
  let line = `M${x(times[0]!)} ${y(prices[0]!)}`;
  for (let i = 1; i < points.length; i++)
    line += step ? `H${x(times[i]!)}V${y(prices[i]!)}` : `L${x(times[i]!)} ${y(prices[i]!)}`;
  return { line, area: `${line}V${height}H${x(times[0]!)}Z` };
}
