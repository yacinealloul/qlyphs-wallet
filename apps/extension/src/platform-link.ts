/** Links to the Qlyphs app's public pages: a token, its mint, a Quark, a collection and one of its
 * items, the points table. */
const ASSET = /^0x[0-9a-f]{80}$/;
const SYMBOL = /^[A-Z0-9]{1,12}$/;

export type PlatformPage =
  | { kind: 'token'; id: string; mint?: boolean }
  | { kind: 'quark'; number: number }
  | { kind: 'collections' }
  | { kind: 'collection'; symbol: string }
  | { kind: 'collection-item'; symbol: string; edition: number }
  | { kind: 'points' };

export function platformURL(base: string, page: PlatformPage): string {
  const url = new URL(base);
  if (url.pathname !== '/' || url.search || url.hash) throw Error('Invalid app origin');
  switch (page.kind) {
    case 'token':
      if (!ASSET.test(page.id)) throw Error('Invalid asset');
      url.pathname = '/tokens/' + page.id;
      if (page.mint) url.hash = 'buy';
      break;
    case 'quark':
      if (!Number.isSafeInteger(page.number) || page.number < 0) throw Error('Invalid Quark');
      url.pathname = '/quarks/' + page.number;
      break;
    case 'collections':
      url.pathname = '/collections';
      break;
    case 'collection':
      if (!SYMBOL.test(page.symbol)) throw Error('Invalid collection');
      url.pathname = '/collections/' + page.symbol;
      break;
    case 'collection-item':
      if (!SYMBOL.test(page.symbol) || !Number.isSafeInteger(page.edition) || page.edition < 1)
        throw Error('Invalid collection item');
      url.pathname = `/collections/${page.symbol}/${page.edition}`;
      break;
    case 'points':
      url.pathname = '/points';
      break;
  }
  return url.href;
}
