/** QLYP-v1 Qlyphs fees, for showing the exact cost before requesting a transaction.
 * Every amount is QTC base units (12 decimals) as a bigint: format with formatUnits(fee, 12).
 * These are the protocol's own constants and rules, re-exported rather than restated:
 * - deploy pays DEPLOY_FEE (1 QTC) and mint pays MINT_FEE (0.01 QTC) to QLYPHS_FEE_ACCOUNT in the
 *   same signed batch as the operation; the wallet builds that batch.
 * - any token-for-QTC exchange pays saleFee(price), 1% of the price rounded up, to
 *   QLYPHS_FEE_ACCOUNT. The seller commits it in the offer; the buyer pays it next to the price.
 * - inscribe pays INSCRIBE_FEE (0.1 QTC) to QLYPHS_FEE_ACCOUNT in the same signed batch.
 * - token transfers, pairing, cancellations and plain QTC sends carry no Qlyphs fee. */
import {
  DEPLOY_FEE,
  INSCRIBE_FEE,
  MINT_FEE,
  QLYPHS_FEE_ACCOUNT,
  SALE_FEE_BPS,
  saleFee as protocolSaleFee,
} from '../../native/src/protocol.ts';
import { QlyphsError } from '../../provider/src/index.ts';
import type { PublicTicket, TransactionCommand } from '../../native/src/public.ts';
import { command } from './validation.ts';

export { DEPLOY_FEE, INSCRIBE_FEE, MINT_FEE, QLYPHS_FEE_ACCOUNT, SALE_FEE_BPS };
/** The signed offer inside a `sell` command. */
export type SellOffer = Extract<TransactionCommand, { kind: 'sell' }>['offer'];

function price(value: unknown): bigint {
  if (typeof value === 'bigint' && value >= 0n) return value;
  if (typeof value === 'string' && /^(0|[1-9]\d{0,38})$/.test(value)) return BigInt(value);
  throw new QlyphsError(
    'INVALID_REQUEST',
    'A non-negative price in base units is required',
    'not-submitted',
  );
}
/** 1% of a QTC price, rounded up: ceil(price * SALE_FEE_BPS / 10000). */
export function saleFee(value: bigint | string): bigint {
  return protocolSaleFee(price(value));
}
/** Commit the exact QLYP-v1 sale fee into an offer (fee = saleFee(price), feeTo = Qlyphs). */
export function withSaleFee(offer: Omit<SellOffer, 'fee' | 'feeTo'>): SellOffer {
  return { ...offer, fee: saleFee(offer.price).toString(), feeTo: QLYPHS_FEE_ACCOUNT };
}
/** True when a sell offer commits exactly the QLYP-v1 sale fee; any other offer is rejected. */
export function hasSaleFee(offer: Pick<SellOffer, 'price' | 'fee' | 'feeTo'>): boolean {
  try {
    return offer.feeTo === QLYPHS_FEE_ACCOUNT && price(offer.fee) === saleFee(offer.price);
  } catch {
    return false;
  }
}
/** The Qlyphs fee (QTC base units) the signer of `input` pays on top of network fees.
 * A buy pays the fee its reservation committed, so it requires that reservation's ticket. */
export function qlyphsFee(input: TransactionCommand, ticket?: PublicTicket['ticket']): bigint {
  const c = command(input);
  switch (c.kind) {
    case 'deploy':
      return DEPLOY_FEE;
    case 'mint':
      return MINT_FEE;
    case 'inscribe':
      return INSCRIBE_FEE;
    case 'buy':
      if (!ticket || ticket.key !== c.ticket || !hasSaleFee(ticket.offer))
        throw new QlyphsError(
          'INVALID_REQUEST',
          'The fee of a purchase requires its reservation with a valid QLYP-v1 sale fee',
          'not-submitted',
        );
      return BigInt(ticket.offer.fee);
    default:
      return 0n;
  }
}
