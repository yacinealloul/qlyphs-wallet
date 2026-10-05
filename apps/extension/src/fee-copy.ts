/** Qlyphs fee wording shared by the background and the UI: refusals and review notices. No protocol
 * code, so the UI bundle can import it. */
export const FEES_UNVERIFIED_ERROR = 'Fees cannot be verified right now.';
export const FEE_CEILING_ERROR = "Fee above this wallet's limit; update the wallet.";
export const FEE_ROLE_ERROR =
  'This account manages the Qlyphs fee schedule and cannot pay a Qlyphs fee. Use another account.';
/** The protocol package's refusal before the reviewed mainnet activation. */
export const MAINNET_FEES_OFF = 'QLYP fees are not active on mainnet yet.';
/** Shown next to a rejected operation whose fee was paid: the protocol never refunds it. */
export const FEE_KEPT = 'Qlyphs fee kept';
/** Whether a receipt shows FEE_KEPT: only a rejection keeps a fee, whatever else a service says. */
export const feeKept = (tx: { verdict?: string | null; feeKept?: unknown }): boolean =>
  tx.feeKept === true && typeof tx.verdict === 'string' && tx.verdict.startsWith('rejected: ');

/** Base units (12 decimals) as QTC, without trailing zeros. */
export function qtc(units: string | bigint): string {
  const s = BigInt(units).toString().padStart(13, '0');
  const fraction = s.slice(-12).replace(/0+$/, '');
  return s.slice(0, -12) + (fraction ? '.' + fraction : '') + ' QTC';
}
/** USD cents of `fee` at `rate` (QTC base units per USD), rounded down. */
const usd = (fee: string, rate: string): string => {
  const cents = (BigInt(fee) * 100n) / BigInt(rate);
  return '$' + (cents / 100n).toString() + '.' + (cents % 100n).toString().padStart(2, '0');
};
interface Quote {
  fee: string;
  grid: { id: number; rate: string } | null;
  pending: { effective: number; fee: string } | null;
}
/** The review's Qlyphs fee value. The USD figure is always labelled as derived from the on-chain
 * rate: the wallet pays QTC, never dollars. */
export function feeValue(q: Quote): string {
  if (!q.grid) return qtc(q.fee);
  return `${qtc(q.fee)} (≈ ${usd(q.fee, q.grid.rate)} at the on-chain reference rate, grid #${q.grid.id})`;
}
/** Informational: the operation stays valid when the pending grid applies before inclusion. */
export const pendingFeeNotice = (q: Quote): string | null =>
  q.pending ? `From block ${q.pending.effective} this fee becomes ${qtc(q.pending.fee)}` : null;
/** Every deploy states that the first claim of a symbol wins and the other keeps its fee. A deploy
 * of the same symbol already waiting in the node's pool makes it stronger, never a refusal. */
export function raceWarning(symbol: string, fee: string, pooled: boolean): string {
  const base = `If another deploy of ${symbol} is included first, even in the same block, your ${qtc(fee)} fee is not refunded.`;
  return pooled
    ? `Another deploy of ${symbol} is already waiting to be included. ${base}`
    : base;
}
export const LOW_SUPPLY_WARNING =
  'Little supply is left: if other mints are included first, this one can exceed the cap and be rejected, keeping its Qlyphs fee.';
