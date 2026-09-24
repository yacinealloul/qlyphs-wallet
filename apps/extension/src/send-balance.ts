/** Balance checks live in the protocol package so the extension and the native web wallet share one
 * implementation. This module only re-exports them (type imports only: the UI bundle stays free of
 * protocol code). */
export {
  SEND_FUNDS_ERROR,
  SEND_LOCKED_ERROR,
  QLYPHS_FEE_ERROR,
  SALE_FEE_ERROR,
  FEE_FUNDS_ERROR,
  BUY_FUNDS_ERROR,
  spendableBalance,
  incomingBalance,
  checkSendBalance,
  nativeOutlay,
  checkPayerBalance,
} from '../../../packages/native/src/balance.ts';
export type { PayerBalance as NativeBalance } from '../../../packages/native/src/balance.ts';
