/** Unique symbols and Quarks (docs/native/INSCRIPTIONS.md).
 * - A DEPLOY whose symbol is already claimed is rejected ('symbol taken') and its fee is
 *   not refunded: check `indexer.symbol(symbol)` right before requesting it. A claim in the same
 *   block can still win.
 * - INSCRIBE pays INSCRIBE_FEE (0.1 QTC, exported from fees) to QLYPHS_FEE_ACCOUNT in the same signed batch. Each
 *   Quark is a 1-of-1 asset: TRANSFER / OFFER it with amount 1.
 * - Rendering (§5): never interpret content as HTML or script. Images (including SVG) only as an
 *   <img> from a data: URL, text/* and application/json as escaped text, anything else as a
 *   download link and a hex/size summary. */
import {
  compact,
  encode,
  isContentType,
  MAX_CONTENT_TYPE_BYTES,
  MAX_PAYLOAD,
  PROTOCOL_HEADER,
} from '../../native/src/codec.ts';
import { INSCRIPTION_DEFINITION } from '../../native/src/protocol.ts';
import { QlyphsError } from '../../provider/src/index.ts';
import type { TransactionCommand } from '../../native/src/public.ts';

export { INSCRIPTION_DEFINITION, isContentType, MAX_PAYLOAD };
export type InscribeCommand = Extract<TransactionCommand, { kind: 'inscribe' }>;

/** Bytes an INSCRIBE payload spends before its content: header, genesis, sequence, tag, the
 * content type vector and the content vector's compact length. */
const FIXED = (PROTOCOL_HEADER.length - 2) / 2 + 32 + 8 + 1;
const compactLength = (n: number): number => compact(BigInt(n)).length;

function request(message: string): never {
  throw new QlyphsError('INVALID_REQUEST', message, 'not-submitted');
}
/** The largest content (in bytes) an INSCRIBE with this content type can carry in one payload. */
export function maxInscriptionBytes(contentType: string): number {
  if (!isContentType(contentType)) request('Invalid Quark content type');
  const head = FIXED + compactLength(contentType.length) + contentType.length;
  let n = MAX_PAYLOAD - head;
  while (n + compactLength(n) > MAX_PAYLOAD - head) n--;
  return n;
}
/** A canonical `inscribe` command for `content`, checked against the payload limit. */
export function inscribeCommand(contentType: string, content: Uint8Array): InscribeCommand {
  if (!(content instanceof Uint8Array) || content.length < 1)
    request('Quark content must be at least 1 byte');
  const max = maxInscriptionBytes(contentType);
  if (content.length > max)
    request(`Quark content is ${content.length} bytes; at most ${max} fit one payload`);
  const hex = '0x' + Array.from(content, (b) => b.toString(16).padStart(2, '0')).join('');
  // Defense in depth: the protocol encoder agrees with the size rule above.
  const bytes = encode({
    genesis: '0x' + '00'.repeat(32),
    sequence: 0n,
    op: { kind: 'inscribe', contentType, content: hex },
  });
  if (bytes.length > MAX_PAYLOAD) request('Quark payload too large');
  return { kind: 'inscribe', contentType, content: hex };
}
export { MAX_CONTENT_TYPE_BYTES };
