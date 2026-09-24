/** QLYP-v1 Qlyphs fees, recomputed by the wallet itself. The service's cost estimate is only
 * trusted for network charges: a server asking for any other Qlyphs fee is refused. */
import { requireThat } from '../../../packages/native/src/codec.ts';
import { qlyphsFee } from '../../../packages/native/src/commands.ts';
import type { Command } from '../../../packages/native/src/commands.ts';
import { PROTOCOL_LABEL, QLYPHS_FEE_ACCOUNT, saleFee } from '../../../packages/native/src/protocol.ts';
import type { Ticket } from '../../../packages/native/src/protocol.ts';
import {
  BUY_FUNDS_ERROR,
  checkPayerBalance as checkProtocolPayerBalance,
  checkSendBalance,
  FEE_FUNDS_ERROR,
  nativeOutlay as protocolOutlay,
  QLYPHS_FEE_ERROR,
  SALE_FEE_ERROR,
} from './send-balance.ts';
import type { NativeBalance } from './send-balance.ts';

export { PROTOCOL_LABEL };
export { BUY_FUNDS_ERROR, FEE_FUNDS_ERROR, QLYPHS_FEE_ERROR, SALE_FEE_ERROR };

type Offer = { price: bigint; fee: bigint; feeTo: string };
/** Any token-for-QTC exchange pays exactly 1% (rounded up) to the Qlyphs fee account. */
export function checkSaleOffer(offer: Offer): void {
  requireThat(offer.fee === saleFee(offer.price) && offer.feeTo === QLYPHS_FEE_ACCOUNT, SALE_FEE_ERROR);
}
/** The Qlyphs fee this signer pays, computed locally from the protocol rules
 * (0.1 QTC, INSCRIBE_FEE, to create a Quark). */
export function expectedQlyphsFee(command: Command, ticket?: Ticket): bigint {
  if (command.kind === 'sell') checkSaleOffer(command.offer);
  if (command.kind === 'buy') {
    requireThat(ticket !== undefined, QLYPHS_FEE_ERROR);
    checkSaleOffer(ticket!.offer);
  }
  return qlyphsFee(command, ticket);
}
export function checkQlyphsFee(command: Command, ticket: Ticket | undefined, platformFee: string): void {
  requireThat(platformFee === expectedQlyphsFee(command, ticket).toString(), QLYPHS_FEE_ERROR);
}
/** QTC the signer spends besides fees, or undefined when the operation needs no balance check.
 * Inscribing spends only fees. */
export function nativeOutlay(command: Command, ticket?: Ticket): bigint | undefined {
  if (command.kind === 'inscribe') return 0n;
  return protocolOutlay(command, ticket);
}
type Costs = Parameters<typeof checkProtocolPayerBalance>[1];
/** Refuse an operation the signer cannot afford from finalized spendable QTC. For an inscription
 * the Qlyphs fee is the locally recomputed one, never the service's figure. */
export function checkPayerBalance(
  balance: NativeBalance,
  costs: Costs,
  command: Command,
  ticket?: Ticket,
): void {
  if (command.kind === 'inscribe') {
    const local = { ...costs, platformFee: expectedQlyphsFee(command).toString() };
    checkSendBalance(balance, local, 0n, FEE_FUNDS_ERROR);
    return;
  }
  checkProtocolPayerBalance(balance, costs, command, ticket);
}
