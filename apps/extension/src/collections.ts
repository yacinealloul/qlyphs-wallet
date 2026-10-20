/** Collections: named sets of Quarks (the Qlyphs collection standard, convention v1), for display.
 * The Qlyphs app replays the convention and serves each collection's items; the wallet reads that
 * answer only for Quarks the indexer already says the account holds, so the app can name, number and
 * draw an item, never add one or claim who owns it. Nothing here signs or reaches a review's terms. */
import { hexBytes } from './qlyph-render.ts';

/** Collections the wallet lists at most, and items per collection (the app's first page). */
const MAX_COLLECTIONS = 40;
const MAX_ITEMS = 60;
/** Same ceiling as an item's own Quark: anything bigger is not an item the wallet draws. */
const MAX_CONTENT_HEX = 2 + 2 * 64 * 1024;
const SYMBOL = /^[A-Z0-9]{1,12}$/;
const ASSET_ID = /^0x[0-9a-f]{80}$/;
const ACCOUNT = /^0x[0-9a-f]{64}$/;
const CONTENT_TYPE = /^[a-z0-9][a-z0-9.+-]{0,63}\/[a-z0-9][a-z0-9.+-]{0,63}$/;
const LAYERS_TYPE = 'application/vnd.qlyphs.layers';

export interface CollectionItem {
  /** The Quark's asset id and number. */
  id: string;
  quark: number;
  /** The item's number inside its collection, from 1. */
  edition: number;
  contentType: string;
  content: string;
  traits: [string, string][];
  /** 1 is the rarest; null for a collection without traits. */
  rank: number | null;
}
export interface HeldCollection {
  symbol: string;
  name: string;
  /** Null for an open edition. */
  supply: number | null;
  minted: number;
  /** The account deployed it: listed even while it holds none of its items. */
  created: boolean;
  /** The collection's picture, for a card without items to draw. */
  cover: Cover | null;
  items: CollectionItem[];
}
export type Cover = { contentType: string; content: string };
export interface Holdings {
  /** False where the app serves no collections on this network. */
  open: boolean;
  collections: HeldCollection[];
  /** Some collection has more of this account's items than the first page. */
  more: boolean;
}

/** A collection's cover as the app sends it, kept only as checked Quark content. */
function coverOf(value: unknown): Cover | null {
  const c = value as { contentType?: unknown; content?: unknown } | undefined;
  return c &&
    typeof c.contentType === 'string' &&
    CONTENT_TYPE.test(c.contentType) &&
    typeof c.content === 'string' &&
    c.content.length <= MAX_CONTENT_HEX &&
    /^0x(?:[0-9a-f]{2})*$/.test(c.content)
    ? { contentType: c.contentType, content: c.content }
    : null;
}
const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
const count = (value: unknown) => (Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null);

function item(value: unknown, owner: string, held: ReadonlySet<string>): CollectionItem | null {
  if (!value || typeof value !== 'object') return null;
  const i = value as Record<string, unknown>;
  if (i.owner !== owner || typeof i.id !== 'string' || !ASSET_ID.test(i.id) || !held.has(i.id)) return null;
  const quark = count(i.quark),
    edition = count(i.edition);
  if (quark === null || edition === null || edition < 1) return null;
  if (typeof i.contentType !== 'string' || !CONTENT_TYPE.test(i.contentType)) return null;
  if (typeof i.content !== 'string' || i.content.length > MAX_CONTENT_HEX) return null;
  try {
    hexBytes(i.content);
  } catch {
    return null;
  }
  const traits: [string, string][] = [];
  if (i.traits && typeof i.traits === 'object')
    for (const [type, v] of Object.entries(i.traits as Record<string, unknown>).slice(0, 16)) {
      const name = text(type, 32),
        trait = text(v, 48);
      if (name && trait) traits.push([name, trait]);
    }
  const rank = count(i.rank);
  return {
    id: i.id,
    quark,
    edition,
    contentType: i.contentType,
    content: i.content,
    traits,
    rank: traits.length && rank ? rank : null,
  };
}

/** Reads one JSON answer of the app: `null` for 404, the app's "not open here". */
async function read(url: string, fetcher: typeof fetch, max = 2 * 1024 * 1024): Promise<unknown> {
  const res = await fetcher(url, {
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (res.status !== 200 || !res.body) throw Error(`Collections unavailable (${res.status})`);
  if (Number(res.headers.get('content-length') ?? 0) > max) throw Error('Collections answer too large');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > max) throw Error('Collections answer too large');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** The collections whose items `owner` holds, among the Quarks in `held` (asset ids the indexer
 * lists for the account). Without a held Quark there is nothing to ask the app. */
export async function readHoldings(
  base: string,
  owner: string,
  held: ReadonlySet<string>,
  fetcher: typeof fetch = fetch,
): Promise<Holdings> {
  if (!ACCOUNT.test(owner)) throw Error('Invalid account');
  if (!held.size) return { open: true, collections: [], more: false };
  const list = (await read(new URL('/api/collections', base).href, fetcher)) as { collections?: unknown } | null;
  if (list === null) return { open: false, collections: [], more: false };
  if (!Array.isArray(list.collections)) throw Error('Invalid collections');
  const candidates: Omit<HeldCollection, 'items'>[] = [];
  for (const c of list.collections as Record<string, unknown>[]) {
    if (candidates.length >= MAX_COLLECTIONS) break;
    if (!c || typeof c.symbol !== 'string' || !SYMBOL.test(c.symbol)) continue;
    const minted = count(c.minted) ?? 0;
    // The account's own collections are listed even before anyone mints.
    const created = c.creator === owner;
    if (!minted && !created) continue;
    candidates.push({
      symbol: c.symbol,
      name: text(c.name, 48) || c.symbol,
      supply: count(c.supply),
      minted,
      created,
      cover: coverOf(c.cover),
    });
  }
  let more = false;
  const collections: HeldCollection[] = [];
  // A few at a time: one request per collection, as the app's own portfolio reads them.
  for (let at = 0; at < candidates.length; at += 4) {
    const pages = await Promise.all(
      candidates.slice(at, at + 4).map(async (c) => {
        if (!c.minted) return { c, page: { items: [] } as { items?: unknown; more?: unknown } };
        const query = new URLSearchParams({ symbol: c.symbol, sort: 'recent', owner, offset: '0' });
        const page = (await read(new URL('/api/collection-items?' + query, base).href, fetcher).catch(
          () => null,
        )) as { items?: unknown; more?: unknown } | null;
        return { c, page };
      }),
    );
    for (const { c, page } of pages) {
      if (!page || !Array.isArray(page.items)) {
        if (c.created) collections.push({ ...c, items: [] });
        continue;
      }
      const items = page.items
        .slice(0, MAX_ITEMS)
        .map((i) => item(i, owner, held))
        .filter((i): i is CollectionItem => i !== null);
      if (page.more === true) more = true;
      if (items.length || c.created) collections.push({ ...c, items });
    }
  }
  return { open: true, collections, more };
}

/** A collection as Explore lists it: what it is called, how far its mint has gone, its cover. */
export interface CollectionSummary {
  symbol: string;
  name: string;
  /** Null for an open edition. */
  supply: number | null;
  minted: number;
  owners: number;
  cover: { contentType: string; content: string } | null;
}
/** The collections the app lists, at most 40, busiest first; `open: false` where it serves none. */
export async function readCollections(
  base: string,
  fetcher: typeof fetch = fetch,
): Promise<{ open: boolean; collections: CollectionSummary[] }> {
  const list = (await read(new URL('/api/collections', base).href, fetcher)) as { collections?: unknown } | null;
  if (list === null) return { open: false, collections: [] };
  if (!Array.isArray(list.collections)) throw Error('Invalid collections');
  const out: CollectionSummary[] = [];
  for (const c of list.collections as Record<string, unknown>[]) {
    if (!c || typeof c.symbol !== 'string' || !SYMBOL.test(c.symbol)) continue;
    const minted = count(c.minted);
    if (minted === null) continue;
    out.push({
      symbol: c.symbol,
      name: text(c.name, 48) || c.symbol,
      supply: count(c.supply),
      minted,
      owners: count(c.owners) ?? 0,
      cover: coverOf(c.cover),
    });
  }
  out.sort((a, b) => b.minted - a.minted || a.name.localeCompare(b.name));
  return { open: true, collections: out.slice(0, MAX_COLLECTIONS) };
}

/** What a Quark's content is to a collection, read from the bytes being signed: a deploy, add or
 * mint document, or a part of a collection's art. The collection's rules decide later whether it
 * counts; the Quark itself is inscribed either way. */
export type CollectionRole = { role: 'deploy' | 'add' | 'mint' | 'layers'; symbol: string };
export function collectionRole(contentType: string, content: string): CollectionRole | null {
  let bytes: Uint8Array;
  try {
    bytes = hexBytes(content);
  } catch {
    return null;
  }
  if (contentType === LAYERS_TYPE) {
    // [version 1][symbol length][symbol][part index][parts][chunk]
    const length = bytes[1] ?? 0;
    if (bytes.length < 6 || bytes[0] !== 1 || length < 1 || bytes.length < 2 + length + 3) return null;
    const symbol = String.fromCharCode(...bytes.subarray(2, 2 + length));
    return SYMBOL.test(symbol) ? { role: 'layers', symbol } : null;
  }
  if (contentType !== 'application/json' || bytes.length > 1024) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  if (d.p !== 'qlyphs-collection' || d.v !== 1 || typeof d.sym !== 'string' || !SYMBOL.test(d.sym)) return null;
  return d.op === 'deploy' || d.op === 'add' || d.op === 'mint' ? { role: d.op, symbol: d.sym } : null;
}
