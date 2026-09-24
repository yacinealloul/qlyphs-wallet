/** Unique symbols and Quarks (docs/native/INSCRIPTIONS.md), background side: strict
 * readers for the native read APIs and the checks the wallet runs before a review is shown. */
import { isContentType, MAX_PAYLOAD, requireThat } from '../../../packages/native/src/codec.ts';
import type { Command } from '../../../packages/native/src/commands.ts';
import type {
  PublicInscription,
  PublicInscriptionSummary,
  PublicSymbol,
} from '../../../packages/native/src/public.ts';

import {
  QLYPH_AMOUNT_ERROR,
  QLYPH_MINT_ERROR,
  QLYPH_READ_ERROR,
  QLYPH_SIZE_ERROR,
  SYMBOL_READ_ERROR,
  symbolTakenError,
} from './qlyph-errors.ts';
export {
  QLYPH_AMOUNT_ERROR,
  QLYPH_MINT_ERROR,
  QLYPH_READ_ERROR,
  QLYPH_SIZE_ERROR,
  SYMBOL_READ_ERROR,
  symbolTakenError,
};
const compactLength = (n: number) => (n < 64 ? 1 : n < 16384 ? 2 : 4);
/** Largest content (bytes) an INSCRIBE of this content type can carry: the whole payload is
 * header 5 + genesis 32 + sequence 8 + tag 1 + Vec(contentType) + Vec(content) <= MAX_PAYLOAD. */
export function maxInscriptionBytes(contentType: string): number {
  const fixed = 5 + 32 + 8 + 1 + contentType.length + compactLength(contentType.length);
  let n = MAX_PAYLOAD - fixed - 1;
  while (n > 0 && fixed + compactLength(n) + n > MAX_PAYLOAD) n--;
  return n;
}
/** Refuse, with a clear message, an INSCRIBE whose content cannot fit one payload. */
export function checkInscribe(command: Command): void {
  if (command.kind !== 'inscribe') return;
  requireThat(
    (command.content.length - 2) / 2 <= maxInscriptionBytes(command.contentType),
    QLYPH_SIZE_ERROR,
  );
}

const ID = /^0x[0-9a-f]{80}$/,
  ACCOUNT = /^0x[0-9a-f]{64}$/;
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown, min: number) => Number.isSafeInteger(v) && (v as number) >= min;

export function parseSymbol(value: unknown, symbol: string): PublicSymbol {
  requireThat(
    isObject(value) &&
      value.symbol === symbol &&
      typeof value.available === 'boolean' &&
      (value.asset === null || (typeof value.asset === 'string' && ID.test(value.asset))) &&
      value.available === (value.asset === null),
    SYMBOL_READ_ERROR,
  );
  return value as unknown as PublicSymbol;
}
export function parseInscriptionSummary(value: unknown): PublicInscriptionSummary {
  requireThat(
    isObject(value) &&
      typeof value.id === 'string' &&
      ID.test(value.id) &&
      count(value.number, 1) &&
      typeof value.creator === 'string' &&
      ACCOUNT.test(value.creator) &&
      typeof value.owner === 'string' &&
      ACCOUNT.test(value.owner) &&
      typeof value.locked === 'boolean' &&
      isContentType(value.contentType) &&
      count(value.size, 1) &&
      (value.size as number) <= MAX_PAYLOAD &&
      typeof value.sha256 === 'string' &&
      /^0x[0-9a-f]{64}$/.test(value.sha256) &&
      count(value.height, 0),
    QLYPH_READ_ERROR,
  );
  return value as unknown as PublicInscriptionSummary;
}
export function parseInscription(value: unknown, id: string): PublicInscription {
  const s = parseInscriptionSummary(value);
  const content = (value as Record<string, unknown>).content;
  requireThat(
    s.id === id &&
      typeof content === 'string' &&
      /^0x(?:[0-9a-f]{2})+$/.test(content) &&
      (content.length - 2) / 2 === s.size,
    QLYPH_READ_ERROR,
  );
  return { ...s, content: content as string };
}
export function parseInscriptionPage(value: unknown): {
  inscriptions: PublicInscriptionSummary[];
  more: boolean;
} {
  requireThat(
    isObject(value) &&
      Array.isArray(value.inscriptions) &&
      value.inscriptions.length <= 50 &&
      typeof value.more === 'boolean',
    QLYPH_READ_ERROR,
  );
  const v = value as { inscriptions: unknown[]; more: boolean };
  return { inscriptions: v.inscriptions.map(parseInscriptionSummary), more: v.more };
}
type Get = (path: string) => Promise<unknown>;
/** Refuse a DEPLOY whose symbol is already claimed: the protocol would reject it after
 * charging its fee. Run right before the review and again right before signing. */
export async function checkSymbol(command: Command, get: Get): Promise<void> {
  if (command.kind !== 'deploy') return;
  let value: unknown;
  try {
    value = await get('/api/symbol?symbol=' + encodeURIComponent(command.symbol));
  } catch {
    throw Error(SYMBOL_READ_ERROR);
  }
  const s = parseSymbol(value, command.symbol);
  requireThat(s.available, symbolTakenError(command.symbol, s.asset!));
}
/** A Quark asset only moves by TRANSFER or OFFER of exactly 1; it cannot be minted. */
export function checkQlyphCommand(command: Command): void {
  if (command.kind === 'mint') throw Error(QLYPH_MINT_ERROR);
  const amount =
    command.kind === 'transfer' ? command.amount : command.kind === 'sell' ? command.offer.amount : 1n;
  requireThat(amount === 1n, QLYPH_AMOUNT_ERROR);
}
/** Inscription numbers of the held Quark ids, from the owner's pages (newest first). */
export async function qlyphNumbers(owner: string, ids: string[], get: Get): Promise<Map<string, number>> {
  const wanted = new Set(ids),
    out = new Map<string, number>();
  for (let offset = 0; wanted.size > out.size && offset <= 1000; offset += 50) {
    const page = parseInscriptionPage(await get(`/api/inscriptions?owner=${owner}&offset=${offset}`));
    for (const i of page.inscriptions) if (wanted.has(i.id)) out.set(i.id, i.number);
    if (!page.more || !page.inscriptions.length) break;
  }
  return out;
}
