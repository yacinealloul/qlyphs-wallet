/** Quark and symbol refusals: plain strings, so the UI bundle can import them. */
export const QLYPH_READ_ERROR = 'This Quark could not be read. Try again.';
export const QLYPH_AMOUNT_ERROR = 'A Quark moves as a whole: the amount must be exactly 1.';
export const QLYPH_MINT_ERROR = 'A Quark is unique (1 of 1) and cannot be minted.';
export const SYMBOL_READ_ERROR = 'Symbol availability could not be checked. Try again.';
/** Fixed shape, so the UI may show it (errors.ts accepts exactly this pattern). */
export const symbolTakenError = (symbol: string, asset: string) =>
  `The symbol ${symbol} is already taken by token ${asset}. Choose another symbol: a second claim is rejected and its fee is not refunded.`;
export const SYMBOL_TAKEN_PATTERN =
  /^The symbol [A-Z0-9]{1,12} is already taken by token 0x[0-9a-f]{80}\. Choose another symbol: a second claim is rejected and its fee is not refunded\.$/;

export const QLYPH_SIZE_ERROR =
  'This content is too large for one Quark. A Quark must fit in a single 1024-byte payload.';
