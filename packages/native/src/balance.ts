/** Payer balance checks shared by every wallet (extension and native web wallet): refuse to sign an
 * operation the signer cannot afford, QLYP-v1 Qlyphs fee included. Without enough funds the fee leg
 * of the batch fails, the whole extrinsic reverts, and the signer still pays the network fee.
 * Only type imports from the protocol so UI bundles can load this without protocol code. */
import { requireThat } from './codec.ts';
import type { Command } from './commands.ts';
import type { Ticket } from './protocol.ts';

export const SEND_FUNDS_ERROR =
  'Insufficient spendable QTC. Leave enough for the network fee and minimum account balance.';
export const SEND_LOCKED_ERROR =
  'Part of your balance is still being confirmed. You can send it once it is final.';
/** QLYP-v1 fee refusals. */
export const QLYPHS_FEE_ERROR = 'Service asked for an incorrect Qlyphs fee; signing refused';
export const SALE_FEE_ERROR = 'Sale offers must commit the 1% Qlyphs fee';
export const FEE_FUNDS_ERROR =
  'Insufficient spendable QTC. Leave enough for the Qlyphs fee, network fee and minimum account balance.';
export const BUY_FUNDS_ERROR =
  'Insufficient spendable QTC. Leave enough for the price, Qlyphs fee, network fee and minimum account balance.';

export interface PayerBalance {
  free: string;
  frozen: string;
  /** The same account at the last final block (newer indexers only). */
  finalized?: { free: string; frozen: string };
}
export interface PayerCosts {
  networkFee: string;
  nativeFee: string;
  deposit: string;
  /** The QLYP-v1 Qlyphs fee the signer pays in the same extrinsic. */
  platformFee?: string;
  existentialDeposit: string;
}
/** Only funds present at the last final block are spendable: newer ones can still be reorganized away. */
function settled(balance: PayerBalance): { free: bigint; frozen: bigint } {
  const free = BigInt(balance.free),
    frozen = BigInt(balance.frozen);
  if (!balance.finalized) return { free, frozen };
  const finalFree = BigInt(balance.finalized.free),
    finalFrozen = BigInt(balance.finalized.frozen);
  return {
    free: finalFree < free ? finalFree : free,
    frozen: finalFrozen > frozen ? finalFrozen : frozen,
  };
}
export function spendableBalance(balance: PayerBalance, minimum = 0n): bigint {
  const { free, frozen } = settled(balance);
  const retained = frozen > minimum ? frozen : minimum;
  return free > retained ? free - retained : 0n;
}
/** Received but not yet final: shown as incoming and locked. */
export function incomingBalance(balance: PayerBalance): bigint {
  if (!balance.finalized) return 0n;
  const pending = BigInt(balance.free) - BigInt(balance.finalized.free);
  return pending > 0n ? pending : 0n;
}
export function checkSendBalance(
  balance: PayerBalance,
  costs: PayerCosts,
  nativeAmount: bigint,
  fundsError = SEND_FUNDS_ERROR,
): void {
  const fee =
    BigInt(costs.networkFee) +
    BigInt(costs.nativeFee) +
    BigInt(costs.deposit) +
    BigInt(costs.platformFee ?? '0');
  const minimum = BigInt(costs.existentialDeposit);
  if (nativeAmount + fee <= spendableBalance(balance, minimum)) return;
  const unconfirmed = { free: balance.free, frozen: balance.frozen };
  requireThat(!(nativeAmount + fee <= spendableBalance(unconfirmed, minimum)), SEND_LOCKED_ERROR);
  requireThat(false, fundsError);
}
/** QTC the signer spends besides fees, or undefined when the operation needs no balance check here. */
export function nativeOutlay(command: Command, ticket?: Ticket): bigint | undefined {
  switch (command.kind) {
    case 'sendQtc':
      return command.amount;
    case 'buy':
      requireThat(ticket !== undefined, QLYPHS_FEE_ERROR);
      return ticket!.offer.price;
    case 'transfer':
    case 'deploy':
    case 'mint':
      return 0n;
    default:
      return undefined;
  }
}
/** Refuse an operation whose outlay, Qlyphs fee, network fees and existential deposit exceed the
 * signer's spendable balance. `costs.platformFee` must already be checked against qlyphsFee(). */
export function checkPayerBalance(
  balance: PayerBalance,
  costs: PayerCosts & { platformFee: string },
  command: Command,
  ticket?: Ticket,
): void {
  const outlay = nativeOutlay(command, ticket);
  if (outlay === undefined) return;
  const error =
    command.kind === 'buy'
      ? BUY_FUNDS_ERROR
      : command.kind === 'deploy' || command.kind === 'mint'
        ? FEE_FUNDS_ERROR
        : undefined;
  checkSendBalance(balance, costs, outlay, error);
}
