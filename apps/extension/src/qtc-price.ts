/** The QTC market price in US dollars, read from CoinGecko for display only: it never reaches a
 * review, a fee check or a signature (fees use the on-chain reference rate). */

export const PRICE_ORIGIN = 'https://api.coingecko.com';
const COIN = 'quantus';
const MAX_BYTES = 1024 * 1024;
/** Chart periods, in days of CoinGecko history. */
export const USD_RANGES = [
  ['1D', 1],
  ['1W', 7],
  ['1M', 30],
  ['1Y', 365],
] as const;
export type UsdRange = (typeof USD_RANGES)[number][0];

export interface QtcPrice {
  usd: number;
  /** Percent change over 24 hours, when CoinGecko gives one. */
  change: number | null;
}

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function parsePrice(answer: unknown): QtcPrice {
  const coin = answer && typeof answer === 'object' ? (answer as Record<string, unknown>)[COIN] : undefined;
  const fields = coin && typeof coin === 'object' ? (coin as Record<string, unknown>) : {};
  if (!positive(fields.usd) || fields.usd > 1e9) throw Error('Price unavailable');
  const change = fields.usd_24h_change;
  return {
    usd: fields.usd,
    change: typeof change === 'number' && Number.isFinite(change) && Math.abs(change) < 1e6 ? change : null,
  };
}

/** [time ms, USD] points, oldest first; malformed points are left out. */
export function parseChart(answer: unknown): [number, number][] {
  const prices = answer && typeof answer === 'object' ? (answer as Record<string, unknown>).prices : undefined;
  if (!Array.isArray(prices)) throw Error('Price history unavailable');
  const points = prices
    .slice(0, 2000)
    .filter(
      (p): p is [number, number] =>
        Array.isArray(p) && Number.isSafeInteger(p[0]) && p[0] > 0 && positive(p[1]) && p[1] <= 1e9,
    )
    .map(([t, usd]) => [t, usd] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  if (points.length < 2) throw Error('Price history unavailable');
  return points;
}

async function read(path: string, fetcher: typeof fetch): Promise<unknown> {
  const res = await fetcher(PRICE_ORIGIN + path, {
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(8000),
  });
  if (res.status !== 200) throw Error(`Price unavailable (${res.status})`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw Error('Price answer too large');
  return JSON.parse(text);
}

export async function readQtcPrice(fetcher: typeof fetch = fetch): Promise<QtcPrice> {
  return parsePrice(await read(`/api/v3/simple/price?ids=${COIN}&vs_currencies=usd&include_24hr_change=true`, fetcher));
}

export async function readQtcChart(range: UsdRange, fetcher: typeof fetch = fetch): Promise<[number, number][]> {
  const days = USD_RANGES.find(([r]) => r === range)![1];
  return parseChart(await read(`/api/v3/coins/${COIN}/market_chart?vs_currency=usd&days=${days}`, fetcher));
}

/** Dollars with cents, or four significant digits below one dollar. */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return '—';
  if (usd > 0 && usd < 1)
    return '$' + usd.toLocaleString('en-US', { maximumSignificantDigits: 4, minimumSignificantDigits: 2 });
  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** A balance's dollar value: cents, and `<$0.01` for less. */
export function formatUsdValue(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return '—';
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
/** A change in dollars, signed: `+$1.20`, `−$0.40`, `−<$0.01`. */
export function formatUsdChange(usd: number): string {
  if (!Number.isFinite(usd)) return '';
  const size = formatUsdValue(Math.abs(usd));
  return (usd < 0 ? '−' : '+') + size;
}
