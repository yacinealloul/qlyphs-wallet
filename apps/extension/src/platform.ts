/** Display-only reads for the wallet's Qlyphs views: token logos and profiles, the token catalogue
 * and points. Nothing here signs, and nothing read here ever reaches a review: a logo is a picture, a
 * profile a few lines of text and links, a catalogue entry a link. A logo is fetched by the
 * background, checked, and handed to the page as a data: URL, so the page never loads a remote image. */
import {
  PROGRESSIVE_MINT_LOTS,
  PROGRESSIVE_MINT_PROFILE,
  PROGRESSIVE_MINT_PROFILE_V2,
  progressiveLotFee,
  progressiveMintQuote,
} from '../../../packages/native/src/progressive-mint.ts';

export const ASSET_ID = /^0x[0-9a-f]{80}$/;
/** Lots that share one Qlyphs fee (progressive-mint.ts: five tiers of 200). Kept here because the
 * witnesses' rules hash covers that module's source: display code must not change it. */
const LOTS_PER_TIER = 200n;
/** Same ceiling as the app's upload check. */
export const LOGO_MAX_BYTES = 128 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
type LogoType = (typeof LOGO_TYPES)[number];

/** The image type its leading bytes prove, whatever the server claimed. */
export function sniffLogo(bytes: Uint8Array): LogoType | null {
  const b = (i: number) => bytes[i];
  if (bytes.length >= 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
  if (bytes.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** `null`: the token has no logo. Throws when the answer cannot be trusted or the app is unavailable,
 * so the caller tries again later instead of remembering "no logo". */
export async function readTokenLogo(
  base: string,
  asset: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  if (!ASSET_ID.test(asset)) throw Error('Invalid asset');
  const res = await fetcher(new URL('/api/token-logo/' + asset, base).href, {
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 204) return null;
  if (res.status !== 200 || !res.body) throw Error(`Logo unavailable (${res.status})`);
  const claimed = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > LOGO_MAX_BYTES) throw Error('Logo too large');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > LOGO_MAX_BYTES) throw Error('Logo too large');
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
  const type = sniffLogo(bytes);
  if (!type || type !== claimed) throw Error('Logo is not an accepted image');
  return `data:${type};base64,${base64(bytes)}`;
}

/** What a token's creator wrote about it on Qlyphs. Every field is optional and already checked:
 * plain text, an https website, and bare X and Telegram handles. */
export interface TokenProfile {
  description: string | null;
  website: string | null;
  x: string | null;
  telegram: string | null;
}

/** Same limits as the app's profile form. */
const MAX_DESCRIPTION = 280;
const PROFILE_MAX_BYTES = 8 * 1024;
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const TELEGRAM_HANDLE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

/** A profile answer reduced to fields the wallet can show safely; null when nothing is left. A
 * field that fails its check is dropped, never shown as given. */
export function tokenProfile(answer: unknown): TokenProfile | null {
  if (!answer || typeof answer !== 'object') return null;
  const a = answer as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  // Control and bidirectional-override characters could disguise the text around them.
  const description = text(a.description).replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '');
  let website: string | null = null;
  try {
    const raw = text(a.website);
    const u = raw && raw.length <= 200 ? new URL(raw) : null;
    if (u && u.protocol === 'https:' && !u.username && !u.password) website = u.href;
  } catch {
    website = null;
  }
  const x = text(a.x).replace(/^@/, '');
  const telegram = text(a.telegram).replace(/^@/, '');
  const profile: TokenProfile = {
    description: description && [...description].length <= MAX_DESCRIPTION ? description : null,
    website,
    x: X_HANDLE.test(x) ? x : null,
    telegram: TELEGRAM_HANDLE.test(telegram) ? telegram : null,
  };
  return profile.description || profile.website || profile.x || profile.telegram ? profile : null;
}

/** `null`: the token has no profile. Throws when the app is unavailable, so the caller tries again
 * later instead of remembering "no profile". */
export async function readTokenProfile(
  base: string,
  asset: string,
  fetcher: typeof fetch = fetch,
): Promise<TokenProfile | null> {
  if (!ASSET_ID.test(asset)) throw Error('Invalid asset');
  const res = await fetcher(new URL('/api/token-profile?asset=' + asset, base).href, {
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404 || res.status === 204) return null;
  if (res.status !== 200) throw Error(`Profile unavailable (${res.status})`);
  const body = await res.text();
  if (body.length > PROFILE_MAX_BYTES) throw Error('Profile too large');
  const answer = JSON.parse(body) as { asset?: unknown };
  // An answer about another token is not this token's profile.
  if (answer.asset !== asset) throw Error('Profile for another asset');
  return tokenProfile(answer);
}

/** Reads by asset, kept briefly: a known value for 10 minutes, a known absence for one. */
export function logoCache<T>(read: (asset: string) => Promise<T | null>, limit = 200) {
  const entries = new Map<string, { value: T | null; until: number }>();
  const pending = new Map<string, Promise<T | null>>();
  return async (asset: string): Promise<T | null> => {
    const hit = entries.get(asset);
    if (hit && hit.until > Date.now()) return hit.value;
    const running = pending.get(asset);
    if (running) return running;
    const job = read(asset)
      .then((value) => {
        entries.delete(asset);
        entries.set(asset, { value, until: Date.now() + (value ? 600_000 : 60_000) });
        while (entries.size > limit) entries.delete(entries.keys().next().value!);
        return value;
      })
      .finally(() => pending.delete(asset));
    pending.set(asset, job);
    return job;
  };
}

/** One token of the catalogue, as the Explore view lists it. */
export interface CatalogToken {
  id: string;
  symbol: string;
  decimals: number;
  /** Progressive tokens: lots minted of 1000, and the Qlyphs fee of the next lot (planck), or null
   * once all lots are minted. The fee steps up every 200 lots: `inTier` lots of the current tier are
   * minted, `leftInTier` remain at `nextFee`, then `nextTierFee` applies (null in the last tier). */
  lots?: {
    minted: number;
    total: number;
    nextFee: string | null;
    tier: number;
    inTier: number;
    leftInTier: number;
    nextTierFee: string | null;
  };
  holders: number;
  transactions: number;
  createdAt: number | null;
  /** The last completed sale: the price paid (planck) for `amount` base units. */
  lastSale: { price: string; amount: string } | null;
}

interface StateAsset {
  id: string;
  minted?: string;
  definition: { symbol: string; decimals: number; cap: string; policy: string };
  right?: unknown;
}
interface AssetStat {
  id: string;
  holders?: number;
  transactions?: number;
  createdAt?: number | null;
  lastSale?: { price: string; amount: string } | null;
}

/** The catalogue from the indexer's token list and its statistics. Quarks are not tokens. */
export function catalog(assets: readonly StateAsset[], stats: readonly AssetStat[]): CatalogToken[] {
  const byId = new Map(stats.map((s) => [s.id, s]));
  const out: CatalogToken[] = [];
  for (const a of assets) {
    if (!ASSET_ID.test(a.id) || a.definition.policy === 'inscription') continue;
    const s = byId.get(a.id);
    const token: CatalogToken = {
      id: a.id,
      symbol: String(a.definition.symbol).slice(0, 32),
      decimals: Number(a.definition.decimals),
      holders: Number(s?.holders ?? 0),
      transactions: Number(s?.transactions ?? 0),
      createdAt: typeof s?.createdAt === 'number' ? s.createdAt : null,
      lastSale: s?.lastSale && /^\d+$/.test(s.lastSale.price) && /^[1-9]\d*$/.test(s.lastSale.amount) ? s.lastSale : null,
    };
    const profile =
      a.definition.policy === 'progressive'
        ? PROGRESSIVE_MINT_PROFILE
        : a.definition.policy === 'progressive-v2'
          ? PROGRESSIVE_MINT_PROFILE_V2
          : null;
    if (profile)
      try {
        const quote = progressiveMintQuote(BigInt(a.definition.cap), BigInt(a.minted ?? '0'), profile);
        const minted = quote.mintedLots;
        const tier = minted < PROGRESSIVE_MINT_LOTS ? minted / LOTS_PER_TIER + 1n : PROGRESSIVE_MINT_LOTS / LOTS_PER_TIER;
        const tierEnd = tier * LOTS_PER_TIER;
        token.lots = {
          minted: Number(minted),
          total: Number(PROGRESSIVE_MINT_LOTS),
          // The indexer drops the right once every lot is minted: never offer a mint then.
          nextFee: a.right && quote.nextFee !== null ? quote.nextFee.toString() : null,
          tier: Number(tier),
          inTier: Number(minted - (tier - 1n) * LOTS_PER_TIER),
          leftInTier: Number(tierEnd - minted),
          nextTierFee: tierEnd < PROGRESSIVE_MINT_LOTS ? progressiveLotFee(tierEnd + 1n, profile).toString() : null,
        };
      } catch {
        // A token the quote cannot read is still listed, without mint progress.
      }
    out.push(token);
  }
  return out;
}

/** What the wallet shows of an account's points: its level, progress through it and rank. */
export interface PointsView {
  level: number;
  xp: string;
  rank: number;
  levelFrom: string;
  levelTo: string;
}

export function pointsView(answer: unknown): PointsView | null {
  const a = (answer as { account?: Record<string, unknown> | null } | null)?.account;
  if (!a) return null;
  const digits = (v: unknown) => (typeof v === 'string' && /^\d{1,30}$/.test(v) ? v : null);
  const xp = digits(a.xp),
    from = digits(a.levelFrom),
    to = digits(a.levelTo),
    level = Number(digits(a.level) ?? a.level),
    rank = Number(a.rank);
  if (xp === null || from === null || to === null || !Number.isSafeInteger(level) || !Number.isSafeInteger(rank))
    return null;
  return { level, xp, rank, levelFrom: from, levelTo: to };
}
