import { explorerURL } from './explorer-link.ts';
import { EXPLORER } from './config.ts';
import { linkWallet, openLinkedWallet, validateLinkedWallet } from './linked-wallets.ts';
import type { WalletAccess } from './linked-wallets.ts';
import { VAULT_PASSWORD_ERROR } from './vault.ts';
import { ACCOUNT_SCOPED_ACTIONS } from './account-scope.ts';
import {
  activeRecord,
  activate,
  records,
  addAccount,
  addDerivedAccount,
  nextDerivation,
  recordIdentity,
  setWalletPasskey,
  selectAccount,
  validateAccounts,
  accountName,
  MAX_ACCOUNTS,
} from './accounts.ts';
import type { AccountBook } from './accounts.ts';
import { exportWallet, parseWalletBackup, verifyBackupAccounts } from './account-backup.ts';
import { validatePasskey, wrapPasskey, unwrapPasskey } from './passkey-vault.ts';
import { displayReady, displayStatus, setDisplayMode } from './display.ts';
import { sameNetwork } from './pinned-network.ts';
import type { PasskeyVault } from './passkey-vault.ts';
import { notificationOutcome, notificationText, notificationCandidates } from './notifications.ts';
/** Privileged wallet controller. The page/content script never receives a key,
 * phrase, password, signed extrinsic or a general-purpose signing capability. */
import { browser } from './browser.ts';
import { uiError } from './errors.ts';
import { reasonOf } from './reasons.ts';
import type { Port, Sender } from './browser.ts';
import {
  ALL_DAPPS,
  API,
  DAPPS,
  PLATFORM,
  customEndpoints,
  defaultEndpoints,
  setEndpoints,
  probeEndpoints,
  CUSTOM_ENDPOINTS,
  loadNetwork,
  NETWORK,
  PROFILE,
  RPC,
  SOLANA_VAULT,
  SWITCHABLE,
  switchNetwork,
  VERSION,
  LOCAL_NETWORK,
} from './config.ts';
import { api, digestOf, network, prepare, recheck, rpc, signingContext, submitToNode, tipBlock } from './network.ts';
import { parseInscription, qlyphSummaries } from './qlyphs.ts';
import type { PublicInscriptionSummary } from '../../../packages/native/src/public.ts';
import { submitOnce } from './submission.ts';
import type { Manifest, Review, View } from './network.ts';
import { ASSET_ID, catalog, logoCache, pointsView, readTokenLogo, readTokenProfile, type TokenProfile } from './platform.ts';
import { readCollections, readHoldings } from './collections.ts';
import { readTrades } from './market.ts';
import type { Trade } from './market.ts';
import type { CollectionSummary, Holdings } from './collections.ts';
import { checkEndpoints, hostPatterns } from './endpoints.ts';
import type { CatalogToken } from './platform.ts';
import { SecretSession, encryptVault, decryptVault, validateVault } from './vault.ts';
import type { Vault } from './vault.ts';
import { identity, wasm } from './signer.ts';
import { reviewSignIn, signSignIn } from './site-session.ts';
import { publicKeyOf, reviewSolanaVault, signSolanaVault } from './solana-vault.ts';
import type { SolanaVaultReview } from './solana-vault.ts';
import type { SiteSessionChallenge } from '../../../packages/provider/src/site-session.ts';
import { parseRequest, exact, pageOrigin, sameExtensionPage, Requests } from './requests.ts';
import type { BoundDocument, Request } from './requests.ts';
import {
  ACCOUNT_STOP_MS,
  ENDED_RETENTION_MS,
  LEASE_MS,
  MIN_START_MS,
  MintSessionController,
  NETWORK_FEE_MARGIN,
  NEVER_RAN_JOURNAL,
  UPDATE_SETTLE_MS,
  endOnRestart,
  endStale,
  pruneSettled,
  resolveFromJournal,
  sessionSnapshot,
  sessionsAvailable,
  sessionPlatform,
  settledRecord,
  ticketCharge,
  validateMintSessions,
} from './mint-session.ts';
import type { MintSessionRecord, Quote, SessionDeps, WalletEndReason } from './mint-session.ts';
import {
  chainReads,
  era,
  findInclusion,
  locatePayment,
  onAncestry,
  proveInclusion,
  proveLineage,
} from './mint-session-chain.ts';
import type { MintSessionReview, MintSessionStatus } from './mint-session-view.ts';
import { generateMnemonic, requireMnemonic } from '../../../packages/chain/src/browser/mnemonic.ts';
import { fromHex, hex, requireThat, assetId } from '../../../packages/native/src/codec.ts';
import { mainnetReviewed } from '../../../packages/native/src/protocol.ts';
import { isRateDerived } from '../../../packages/native/src/fee-schedule.ts';
import { feeRulesFor, FEES_UNVERIFIED_ERROR, MAINNET_FEES_OFF, quoteFees, scheduledQlyphsFee } from './fees.ts';
import { readQtcChart, readQtcPrice, USD_RANGES } from './qtc-price.ts';
import type { QtcPrice, UsdRange } from './qtc-price.ts';
import type { FeeQuote } from './fees.ts';
import { feeKept } from './fee-copy.ts';
import {
  PROGRESSIVE_MINT_LOTS,
  PROGRESSIVE_MINT_PROFILE_V2,
  progressiveLotFee,
} from '../../../packages/native/src/progressive-mint.ts';
import {
  extrinsicHash,
  parseSignedExtrinsic,
} from '../../../packages/chain/src/codec/extrinsic.ts';
import { parseCommand, json } from '../../native/src/commands.ts';
import type { Command } from '../../native/src/commands.ts';
import { NO_TIP_ERROR, parseTip } from '../../../packages/native/src/tip.ts';
import {
  attestationPolicy,
  attestedAsset,
  attestedFees,
  attestedLot,
  authorizePurchase,
  pqConfigured as policyBundled,
  policyPerNetwork,
  usePolicy,
} from '../../native/web/pq-guard.ts';
import type { AttestedAsset } from '../../native/web/pq-guard.ts';
import {
  base58,
  capabilities,
  MINT_SESSION_LIMITS,
  QlyphsError,
  publicError,
  wireError,
  solanaVaultAddress,
  solanaVaultBytes,
  SOLANA_VAULT_METHODS,
} from '../../../packages/provider/src/index.ts';
import type {
  MintSessionSnapshot,
  MintSessionTerms,
  ProviderState,
  PublicErrorCode,
} from '../../../packages/provider/src/index.ts';

interface Account {
  owner: string;
  address: string;
  genesis: string;
}
interface Transaction {
  notified?: string;
  hash: string;
  owner: string;
  genesis: string;
  nonce: number;
  intentId: string;
  createdAt: number;
  label: string;
  status: string;
  validUntil: number;
  nativeSuccess?: boolean | null;
  verdict?: string | null;
  /** The indexer reports the operation rejected with its Qlyphs fee paid; display only. */
  feeKept?: true;
  /** Display-only copy of the approved transfer; never used for signing or status. */
  height?: number;
  amount?: string;
  to?: string;
  symbol?: string;
  decimals?: number;
  /** The token it moves or mints, for its mark in Activity; display only. */
  asset?: string;
  /** The mint session that signed it, and its lot; display and linkage only. */
  session?: string;
  lot?: number;
  /** The network fee estimate the review showed plus the chosen tip (planck); display only. */
  fee?: string;
  /** The Qlyphs fee and the native charges (non-refundable charge plus deposit) the review
   * showed, in planck, when above zero; display only. */
  qlyphsFee?: string;
  charges?: string;
}
interface Stored extends AccountBook {
  access?: WalletAccess;
  version: 2 | 3;
  notifications?: boolean;
  manifest?: Manifest;
  /** Switchable builds: the other network's pinned manifest, kept while this one is active. */
  parked?: Manifest;
  transactions: Transaction[];
  /** Mint session ledger: bookkeeping and display; every liability is also in `transactions`. */
  mintSessions?: MintSessionRecord[];
}
interface Connection extends BoundDocument {
  port: Port;
  alive: boolean;
  ids: Set<string>;
  count: number;
  reset: number;
  revision: number;
  subscribed: boolean;
  snapshot?: string;
  /** The mint session this channel created: the only channel that reads it or hears of it. */
  mint?: MintRun;
  mintSnapshot?: string;
}
/** A UI message's sender, with the side panel request key the message carried (see onMessage). */
type UISender = Sender & { panelKey?: string };
interface Job {
  kind: 'connect' | 'transaction' | 'session' | 'signin' | 'vault';
  owner: string;
  genesis: string;
  epoch: number;
  connection?: Connection;
  requestId?: string;
  connectionRevision?: number;
  review?: Review;
  mintReview?: MintSessionReview;
  /** A site sign-in: the challenge as the site sent it, its decoded fields and the review digest. */
  signIn?: { challenge: string; fields: SiteSessionChallenge; digest: string };
  /** A Solana vault authorization: the message as sent, the key its vault was checked against. */
  solanaVault?: {
    message: string;
    publicKey: Uint8Array;
    review: SolanaVaultReview;
    digest: string;
  };
  windowId?: number;
  windowReady?: Promise<void>;
  /** Shown in the side panel of window `windowId` instead of its own window. */
  panel?: boolean;
  /** The key handed to the one panel page that shows this request; its messages must carry it. */
  panelKey?: string;
  expires?: number;
  cancelled: boolean;
  phase: 'review' | 'signing';
  /** Priority tip changes asked in the review window; only the latest one is kept. */
  retips: number;
  /** The page and document that approved this mint session, while the approval is being saved. */
  approval?: { page: string; documentId?: string };
  reply: (value: unknown) => void;
}
/** What an approval bound a mint session to. Memory only: no window, page or channel survives a
 * restart, so no window can control a session the wallet did not start in this worker. */
interface MintBinding {
  connection: Connection;
  revision: number;
  requestId: string;
  windowId: number;
  /** For a session shown in the side panel: the key of the panel page that approved it. */
  panelKey?: string;
  documentId?: string;
  page: string;
  epoch: number;
  owner: string;
  address: string;
  genesis: string;
  deadline: number;
  unlockDeadline: number;
  /** Renewed by the progress window's polls: signing stops LEASE_MS after the last one. */
  lease: number;
  windowGone: boolean;
}
interface MintRun {
  controller: MintSessionController;
  binding: MintBinding;
}
interface PasskeyAttempt {
  mode: 'enroll' | 'unlock';
  epoch: number;
  salt: string;
  owner: string;
  credentialId?: string;
}
const passkeyAttempts = new Requests<PasskeyAttempt>();
// The session wipes its secret itself at its deadline; the rest of the lock follows in a microtask,
// so that no caller that happened to read the session first sees the wallet half locked.
const session = new SecretSession(undefined, undefined, (epoch) => queueMicrotask(() => ended(epoch)));
let accessReady = false;
const requests = new Requests<Job>(),
  jobs = new Map<string, Job>(),
  connections = new Set<Connection>();
/** One running mint session per `${genesis}:${owner}`; it leaves when its `run()` settles. */
const mintControllers = new Map<string, MintRun>();
/** Sessions their progress window can still read, by approved request id: until the window closes,
 * or ENDED_RETENTION_MS after the end. */
const mintWindows = new Map<string, MintRun>();
/** Ended sessions whose read-only settle task still follows their last payment. */
const mintSettling = new Set<MintSessionController>();
/** Session approvals that their window reloaded or left before the session started, by request id,
 * until the review would have expired: the window's next page is told that nothing started. */
const abandonedStarts = new Map<string, { windowId: number; panelKey?: string; expires: number }>();
const FINAL_STATUSES = ['finalized', 'expired', 'cancelled-before-broadcast'];
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Journal entries the wallet keeps; it never prunes them. */
const JOURNAL_CAPACITY = 200;
// Texts the wallet window matches or shows as they are (errors.ts lists them as safe).
const NO_SESSION = 'No mint session for this window';
const RELOADED_BEFORE_START =
  'This window was reloaded before minting started, so nothing was signed. Start again from the site.';
const LOCKS_TOO_SOON =
  'The wallet locks too soon to start minting. Lock it, unlock it and start again from the site.';
const RECORDS_FULL =
  'Too many mint sessions are still settling; try again once their payments are final';
const ARCHIVE_FULL = 'Archive capacity reached; preserve history before continuing';
let state: Stored = {
  version: 2,
  backed: false,
  grants: {},
  transactions: [],
  otherAccounts: [],
};
let writes: Promise<void> = Promise.resolve(),
  walletBusy = false,
  keyBusy = false,
  resetting = false;
const pendingGrants = new Set<string>();
const root = browser.runtime.getURL('');
/** A network switch in progress: UI requests wait for it (see the privileged handler). */
let switching: Promise<void> | null = null;
/** Where the wallet lives: one state for every network of a switchable build. */
const WALLET_KEY = 'wallet';
/** Switchable builds: `manifest` holds the active network's pin and `parked` the other one's, so
 * the same wallet keeps a pin per network. */
function placeManifests(s: Stored): void {
  const pins = [s.manifest, s.parked].filter((m): m is Manifest => m !== undefined);
  const active = pins.find((m) => m.network === PROFILE.network),
    other = pins.find((m) => m.network !== PROFILE.network);
  if (active) s.manifest = active;
  else delete s.manifest;
  if (other) s.parked = other;
  else delete s.parked;
}
async function readState(): Promise<void> {
  const stored = (await browser.storage.local.get(WALLET_KEY))[WALLET_KEY];
  if (stored !== undefined) {
    const s = stored as Stored;
    const legacy = (stored as { version: number }).version === 1;
    requireThat(
      (legacy || s.version === 2 || s.version === 3) &&
        Array.isArray(s.transactions) &&
        s.transactions.length <= 200 &&
        s.grants &&
        typeof s.grants === 'object',
      'Unsupported wallet data; preserve your backup',
    );
    if (SWITCHABLE) placeManifests(s);
    if (s.vault && SWITCHABLE) validateVault(s.vault, s.vault.genesis);
    else if (s.vault) {
      requireThat(s.manifest, 'Missing network configuration');
      validateVault(s.vault, s.manifest!.genesis);
    }
    if (s.passkey) {
      try {
        requireThat(s.vault, 'Missing wallet');
        validatePasskey(s.passkey, s.vault!, root.replace(/\/$/, ''));
      } catch {
        delete s.passkey;
      }
    }
    requireThat(
      s.notifications === undefined || typeof s.notifications === 'boolean',
      'Invalid notification preference',
    );
    if (legacy) {
      s.version = 2;
      s.otherAccounts = [];
      if (s.vault) {
        s.name = 'Account 1';
        s.accountIndex = 1;
      }
    }
    validateAccounts(s, SWITCHABLE ? undefined : s.manifest?.genesis, root.replace(/\/$/, ''));
    if (s.access) {
      const roots = records(s).filter((a) => !a.derived);
      requireThat(
        roots.some((a) => a.vault.owner === s.access!.owner) &&
          s.access.wallets &&
          typeof s.access.wallets === 'object' &&
          !Array.isArray(s.access.wallets),
        'Invalid linked wallet',
      );
      for (const [owner, linked] of Object.entries(s.access.wallets)) {
        requireThat(
          owner !== s.access.owner && roots.some((a) => a.vault.owner === owner),
          'Invalid linked wallet',
        );
        validateLinkedWallet(linked);
      }
    }
    // The mint session ledger never refuses the wallet: every liability it describes is also in
    // the journal, which keeps gating the account. A ledger that breaks its rules is archived in
    // the same storage operation as the wallet without it, then never trusted again.
    let archive: Record<string, unknown> = {};
    try {
      validateMintSessions(s.mintSessions, s.transactions);
    } catch {
      archive = { ['mint-sessions-archive-' + crypto.randomUUID()]: s.mintSessions };
      s.mintSessions = [];
    }
    for (const tx of s.transactions) {
      // Display-only links to a session; an invalid one is dropped, like an invalid passkey.
      if (
        tx.session !== undefined &&
        !(typeof tx.session === 'string' && SESSION_ID.test(tx.session))
      )
        delete tx.session;
      if (tx.lot !== undefined && !(Number.isSafeInteger(tx.lot) && tx.lot >= 1 && tx.lot <= 1000))
        delete tx.lot;
    }
    state = s;
    if (legacy || Object.keys(archive).length)
      await browser.storage.local.set({ ...archive, [WALLET_KEY]: structuredClone(state) });
    for (const tx of state.transactions)
      if (tx.status === 'signed-not-submitted') tx.status = 'cancelled-before-broadcast';
    // A session never resumes after a restart: no window, page or channel bound it here.
    const ledger = state.mintSessions ?? [];
    endOnRestart(ledger, Date.now());
    resolveFromJournal(ledger, state.transactions);
  }
}
/** Switchable builds: a wallet reaching a network for the first time pins it, as setup does. On
 * mainnet the pin must match the build's; elsewhere it is the network the services report. */
async function pinNetwork(): Promise<void> {
  if (!SWITCHABLE || !state.vault || state.manifest) return;
  const s = await network();
  if (state.manifest) return;
  state.manifest = s.manifest;
  await save();
}
const loaded = (async () => {
  // A switchable build learns its network first: it picks that network's pin.
  await loadNetwork();
  usePolicy(PROFILE.network);
  await browser.storage.local.setAccessLevel?.({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
  await readState();
})();
// A wallet opened on a network it never reached pins it once that network answers; nothing waits.
void loaded.then(pinNetwork).catch(() => undefined);
function save(): Promise<void> {
  requireThat(!resetting, 'Wallet reset in progress. Try again.');
  const snapshot = structuredClone(state);
  const next = writes.then(() => browser.storage.local.set({ [WALLET_KEY]: snapshot }));
  writes = next.catch(() => undefined);
  return next;
}
/** The oldest root owns installation authentication, independent of selection. */
function accessRecord() {
  const roots = records(state).filter((a) => !a.derived);
  const anchor = state.access ? roots.find((a) => a.vault.owner === state.access!.owner) : roots[0];
  requireThat(anchor, 'No wallet selected');
  return anchor!;
}
function unlinkedWallets() {
  if (!state.vault) return [];
  const owner = accessRecord().vault.owner;
  return records(state).filter(
    (a) => !a.derived && a.vault.owner !== owner && !state.access?.wallets[a.vault.owner],
  );
}
function isUnlocked(): boolean {
  return session.unlocked && accessReady && unlinkedWallets().length === 0;
}
/** Refuses once the unlock `epoch` belongs to has ended, without decoding the phrase into a string. */
function stillUnlocked(epoch: number): void {
  requireThat(session.unlocked && session.epoch === epoch, 'Wallet locked; approve again');
}
async function walletClear(
  vault: Vault,
  epoch: number,
  rootClear?: Uint8Array,
): Promise<Uint8Array> {
  const anchor = accessRecord().vault;
  const rootBytes = rootClear ?? new TextEncoder().encode(session.phrase(epoch));
  try {
    if (vault.owner === anchor.owner) return rootBytes.slice();
    const linked = state.access?.wallets[vault.owner];
    requireThat(linked, 'Link your saved wallets first');
    return await openLinkedWallet(
      linked!,
      rootBytes,
      anchor,
      vault,
      root.replace(/\/$/, ''),
      identity,
    );
  } finally {
    if (!rootClear) rootBytes.fill(0);
  }
}
async function verifyInstallation(clear: Uint8Array): Promise<void> {
  for (const record of records(state)) {
    const words = await walletClear(record.vault, session.epoch, clear);
    try {
      await verifyDerived(new TextDecoder().decode(words), record);
    } finally {
      words.fill(0);
    }
  }
}
async function addWalletLink(
  vault: Vault,
  clear: Uint8Array,
  epoch: number,
): Promise<WalletAccess> {
  const anchor = accessRecord().vault,
    rootBytes = new TextEncoder().encode(session.phrase(epoch));
  try {
    const linked = await linkWallet(rootBytes, clear, anchor, vault, root.replace(/\/$/, ''));
    stillUnlocked(epoch);
    return {
      owner: anchor.owner,
      wallets: { ...state.access?.wallets, [vault.owner]: linked },
    };
  } finally {
    rootBytes.fill(0);
  }
}
function setAccessPasskey(passkey?: PasskeyVault): void {
  const owner = accessRecord().vault.owner;
  if (state.vault?.owner === owner) setWalletPasskey(state, passkey);
  for (const a of state.otherAccounts.filter((a) => a.vault.owner === owner)) {
    if (passkey) a.passkey = passkey;
    else delete a.passkey;
  }
}
function changeAccountContext(): void {
  // Before the epoch moves, so that the session ends with this reason rather than `locked`.
  stopMintSessions('account');
  session.invalidate();
  passkeyAttempts.invalidate(() => true);
  invalidate(() => true);
}
function keptFee(tx: Transaction, reported: unknown): void {
  if (feeKept({ verdict: tx.verdict, feeKept: reported })) tx.feeKept = true;
  else delete tx.feeKept;
}
function transferDisplay(review: Review): Partial<Transaction> {
  const c = review.command;
  if (c.kind === 'sendQtc')
    return { amount: String(c.amount), to: String(c.to), symbol: 'QTC', decimals: 12 };
  if (c.kind === 'transfer' && review.asset)
    return {
      amount: String(c.amount),
      to: String(c.to),
      symbol: review.asset.qlyph
        ? `Quark #${review.asset.qlyph.number}`
        : review.asset.definition.symbol,
      decimals: review.asset.definition.decimals,
      ...(review.asset.qlyph ? {} : { asset: String(c.asset) }),
    };
  // The Quark or token it creates, so Activity can show it (a token by its logo).
  if (c.kind === 'inscribe') return { symbol: 'Quark', asset: assetId(review.intent.owner, BigInt(review.intent.sequence)) };
  if (c.kind === 'deploy' || c.kind === 'deployProgressive' || c.kind === 'deployProgressiveV2')
    return { symbol: String(c.symbol), asset: assetId(review.intent.owner, BigInt(review.intent.sequence)) };
  // A mint names its token in Activity; what it minted is in the transaction's detail.
  if ((c.kind === 'mint' || c.kind === 'mintProgressive') && review.asset)
    return { symbol: review.asset.definition.symbol, asset: String(c.asset) };
  return {};
}
/** What the operation pays besides the network fee, as reviewed, for Activity. */
function reviewedCharges(review: Review): Partial<Transaction> {
  const c = review.intent.costs;
  const native = BigInt(c.nativeFee) + BigInt(c.deposit);
  return {
    ...(BigInt(c.platformFee) > 0n ? { qlyphsFee: String(BigInt(c.platformFee)) } : {}),
    ...(native > 0n ? { charges: String(native) } : {}),
  };
}
function accountTransactions(owner = state.vault && state.manifest ? account().owner : undefined): Transaction[] {
  return state.transactions.filter(
    (tx) => tx.owner === owner && tx.genesis === state.manifest?.genesis,
  );
}
function changingAccountAllowed(): void {
  requireThat(
    !keyBusy && ![...jobs.values()].some((job) => job.phase === 'signing'),
    'Finish the current operation before changing accounts',
  );
}
function account(): Account {
  requireThat(state.vault && state.manifest, 'Finish wallet setup in the extension');
  return {
    ...recordIdentity(activeRecord(state)),
    genesis: state.manifest!.genesis,
  };
}
async function verifyDerived(phrase: string, record = activeRecord(state)): Promise<void> {
  if (!record.derived) return;
  let who;
  try {
    who = await identity(phrase, record.derived.index);
  } catch {
    throw Error('Could not derive this account');
  }
  requireThat(
    who.owner === record.derived.owner && who.address === record.derived.address,
    'Saved account identity does not match its derivation',
  );
}
function permitted(c: Connection): boolean {
  if (!state.vault || !state.manifest || !c.alive || pendingGrants.has(c.origin)) return false;
  const grant = state.grants[c.origin];
  return !!grant && grant.owner === account().owner && grant.genesis === state.manifest.genesis;
}
/** Projection is identical for reads/events and contains no private account metadata. */
function projected(c: Connection): ProviderState {
  const accounts = isUnlocked() && permitted(c) ? [account()] : [];
  return { accounts, network: state.manifest ?? null, connected: accounts.length !== 0 };
}
function publishStates(): void {
  // Past the deadline this read locks the session, and `ended` runs once, right after.
  void isUnlocked();
  for (const c of connections) {
    if (!c.alive || !c.subscribed) continue;
    const snapshot = projected(c),
      encoded = JSON.stringify(snapshot);
    if (c.snapshot === encoded) continue;
    c.snapshot = encoded;
    try {
      c.port.postMessage({ event: 'stateChanged', state: snapshot });
    } catch {
      c.alive = false;
      invalidate((j) => j.connection === c);
    }
  }
  for (const c of connections) publishMint(c);
}
/** The creating channel's view of its mint session, while its grant and revision last; else null.
 * Reads and events carry exactly this. */
function mintProjection(c: Connection): MintSessionSnapshot | null {
  const run = c.mint;
  if (!run || !c.alive || c.revision !== run.binding.revision || !permitted(c)) return null;
  return run.controller.snapshot();
}
/** `mintSessionChanged` to the one channel that created the session, when its projection changed
 * (including to null once its grant is gone). No other channel ever hears of a session. */
function publishMint(c: Connection): void {
  if (!c.mint || !c.alive) return;
  const snapshot = mintProjection(c),
    encoded = JSON.stringify(snapshot);
  if (c.mintSnapshot === encoded) return;
  c.mintSnapshot = encoded;
  try {
    c.port.postMessage({ event: 'mintSessionChanged', session: snapshot });
  } catch {
    c.alive = false;
    invalidate((j) => j.connection === c);
  }
}
async function revokeOrigin(origin: string): Promise<void> {
  // Revocation must not silently come back when selecting another saved account.
  for (const record of records(state)) delete record.grants[origin];
  stopMintSessions('revoked', (b) => b.connection.origin === origin);
  for (const c of connections) if (c.origin === origin) c.revision++;
  invalidate((j) => j.connection?.origin === origin);
  publishStates();
  // A persistence failure is reported, never claimed to be a durable revocation.
  await save();
}
function send(c: Connection, id: string, value: unknown): void {
  if (c.alive)
    try {
      const payload = value as { result?: unknown; error?: unknown };
      const error = payload.error ? publicError(payload.error, 'VERIFICATION_FAILED') : null;
      c.port.postMessage(error ? { id, error: wireError(error) } : { id, ...payload });
    } catch {
      c.alive = false;
    }
  c.ids.delete(id);
}
/** Replies to a job's request and drops the job. `release` false keeps the wallet mutex: an approved
 * mint session holds it until its `run()` settles. */
function finish(id: string, value: unknown, release = true): void {
  const job = jobs.get(id);
  if (!job) return;
  requests.remove(id);
  jobs.delete(id);
  job.reply(value);
  if (job.kind !== 'connect' && release) walletBusy = false;
}
function cancel(id: string, code: PublicErrorCode = 'CONTEXT_CHANGED'): void {
  const j = jobs.get(id);
  if (!j) return;
  j.cancelled = true;
  requests.remove(id);
  // A signing handler keeps its mutex until its finally block has completed.
  if (j.phase === 'review') finish(id, { error: publicError({ code }, code, 'not-submitted') });
}
function invalidate(predicate: (j: Job) => boolean): void {
  for (const [id, j] of jobs) if (predicate(j)) cancel(id);
}
// Chrome stops an idle extension service worker after about 30 seconds, which would drop an
// unlocked session long before its fifteen-minute deadline. While unlocked, a trivial extension API
// call every 20 seconds keeps the worker alive. This is a usability choice, not a security one: an
// evicted worker loses the phrase sooner, which is safe, but an unlock would then last only until
// the person's first half-minute pause, typically before the site they unlocked for asks. What
// bounds how long the phrase is held is the deadline, which this never extends: its own timer reads
// the session there, which ends it (see `session`), whatever the keep-alive's phase after a second
// unlock moved the deadline.
let awake: ReturnType<typeof setInterval> | undefined,
  expiry: ReturnType<typeof setTimeout> | undefined;
/** Called after every `session.install`: (re)arms the deadline for the current unlock. */
function stayAwake(): void {
  if (expiry !== undefined) clearTimeout(expiry);
  const deadline = session.deadline;
  // The callback only reads the session: one that fires late, after a new unlock, re-arms for that
  // unlock and ends nothing. One that fires early re-arms for what is left.
  expiry = deadline
    ? setTimeout(() => void (session.unlocked && stayAwake()), Math.max(0, deadline - Date.now()))
    : undefined;
  (expiry as { unref?: () => void } | undefined)?.unref?.();
  if (awake !== undefined) return;
  awake = setInterval(() => {
    if (session.unlocked) void browser.runtime.getPlatformInfo?.();
  }, 20_000);
  // Outside a browser (the test runner), the timer must not keep the process alive.
  (awake as { unref?: () => void }).unref?.();
}
function lock(): void {
  session.lock();
  passkeyAttempts.invalidate(() => true);
  ended(session.epoch);
}
/**
 * Everything a lock ends besides the secret, which the session wipes itself: run once per lock, by
 * lock() or after the session reached its deadline. Work bound to an epoch before `epoch` stops;
 * an unlock begun since keeps its own (passkey attempts of the ended unlock fail on their epoch).
 */
function ended(epoch: number): void {
  if (!session.unlocked) {
    if (awake !== undefined) clearInterval(awake);
    if (expiry !== undefined) clearTimeout(expiry);
    awake = expiry = undefined;
    accessReady = false;
  }
  if (vaultKey && vaultKey.epoch < epoch) vaultKey = null;
  stopMintSessions('locked', (b) => b.epoch < epoch);
  invalidate((j) => j.epoch < epoch);
  publishStates();
}
function current(job: Job): void {
  requireThat(
    !job.cancelled && session.epoch === job.epoch,
    'Request cancelled or session changed',
  );
  requireThat(job.expires === undefined || Date.now() < job.expires, 'Request expired');
  const a = account();
  requireThat(a.owner === job.owner && a.genesis === job.genesis, 'Account or network changed');
  if (job.connection)
    requireThat(
      job.connection.alive &&
        job.connection.revision === job.connectionRevision &&
        (!job.requestId || job.connection.ids.has(job.requestId)) &&
        (job.kind === 'connect' || permitted(job.connection)),
      'Site permission revoked',
    );
}
let historyPending: Promise<Transaction[]> | undefined;
function history(): Promise<Transaction[]> {
  return (historyPending ??= syncHistory().finally(() => {
    historyPending = undefined;
  }));
}
async function notificationPermission() {
  return !!(await browser.permissions?.contains({
    permissions: ['notifications'],
  }));
}
async function notifyHistory() {
  if (!state.notifications || !browser.notifications || !(await notificationPermission())) return;
  if ((await browser.notifications.getPermissionLevel()) !== 'granted') return;
  const candidates = notificationCandidates(state.transactions);
  if (!candidates.length) return;
  // Persist the delivery ledger first: a worker restart cannot announce a result twice.
  for (const tx of candidates) tx.notified = notificationOutcome(tx);
  await save();
  for (const tx of candidates) {
    if (!state.notifications) break;
    try {
      await browser.notifications.create('qlyphs-tx:' + tx.hash, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icon-128.png'),
        ...notificationText(notificationOutcome(tx)),
      });
    } catch {
      /* OS or browser may suppress a notification. The wallet history remains authoritative. */
    }
  }
}
async function syncHistory(): Promise<Transaction[]> {
  let changed = false;
  let trustedStatus: Awaited<ReturnType<typeof network>> | undefined;
  // A final status is never replaced. Each read below is awaited, and meanwhile the entry may
  // become final: a mint session cancels the payment it was signing when a stop lands before its
  // bytes leave. Every await is therefore followed by a fresh check.
  const final = (tx: Transaction) => FINAL_STATUSES.includes(tx.status);
  for (const tx of state.transactions) {
    // Another network's entries wait until the wallet is back on it: only its indexer knows them.
    if (final(tx) || tx.genesis !== state.manifest?.genesis) continue;
    try {
      const s = await api<{
        status: string;
        height?: number | null;
        nativeSuccess?: boolean | null;
        verdict?: string | null;
        feeKept?: boolean;
      }>('/api/transactions/' + tx.hash);
      if (final(tx)) continue;
      if (
        ['pending', 'included', 'finalized', 'expired', 'indexer-unavailable'].includes(s.status)
      ) {
        tx.status = s.status;
        if (Number.isSafeInteger(s.height)) tx.height = s.height!;
        tx.nativeSuccess = s.nativeSuccess;
        tx.verdict = s.verdict;
        keptFee(tx, s.feeKept);
        changed = true;
      }
      // A crash can occur after recording broadcast uncertainty but before the
      // server learns this hash. Only finalized era expiry permits releasing the
      // nonce mutex. Re-query AFTER observing the synchronized finality boundary
      // so a previously stale lookup cannot conceal a subsequently indexed receipt.
      if (
        ['pending', 'unknown', 'broadcast-uncertain'].includes(tx.status) &&
        Number.isSafeInteger(tx.validUntil) &&
        state.manifest
      ) {
        trustedStatus ??= await network(state.manifest);
        if (final(tx)) continue;
        if (trustedStatus.finalized > tx.validUntil) {
          const latest = await api<{
            status: string;
            height?: number | null;
            nativeSuccess?: boolean | null;
            verdict?: string | null;
            feeKept?: boolean;
          }>('/api/transactions/' + tx.hash);
          if (final(tx)) continue;
          // A final entry keeps only the height of the report that made it final: an earlier one
          // may name a block that left the chain, and ended mint sessions compare it with theirs.
          if (latest.status === 'finalized') {
            tx.status = 'finalized';
            if (Number.isSafeInteger(latest.height)) tx.height = latest.height!;
            else delete tx.height;
            tx.nativeSuccess = latest.nativeSuccess;
            tx.verdict = latest.verdict;
            keptFee(tx, latest.feeKept);
            changed = true;
          } else if (['pending', 'unknown', 'expired'].includes(latest.status)) {
            tx.status = 'expired';
            delete tx.height;
            tx.nativeSuccess = null;
            tx.verdict = null;
            delete tx.feeKept;
            changed = true;
          }
        }
      }
    } catch {
      if (final(tx)) continue;
      tx.status = 'unknown';
      changed = true;
    }
  }
  // Ended mint sessions take history's final verdict for the payments they still count as open.
  if (resolveFromJournal(state.mintSessions ?? [], state.transactions)) changed = true;
  if (await fillCharges().catch(() => false)) changed = true;
  if (changed) await save();
  await notifyHistory().catch(() => undefined);
  return state.transactions;
}
/** Creations and mints recorded before the wallet kept the reviewed Qlyphs fee get it once they
 * succeeded in a block, from the fixed mint fee or the indexer's public fee schedule
 * (scheduledQlyphsFee). Display only, asked once per entry and worker. */
const chargesAsked = new Set<string>();
async function fillCharges(): Promise<boolean> {
  const missing = state.transactions.filter(
    (tx) =>
      tx.genesis === state.manifest?.genesis &&
      tx.qlyphsFee === undefined &&
      (tx.label === 'mint' || isRateDerived(tx.label)) &&
      tx.status === 'finalized' &&
      tx.nativeSuccess === true &&
      !tx.verdict?.startsWith('rejected') &&
      Number.isSafeInteger(tx.height) &&
      !chargesAsked.has(tx.hash),
  );
  if (!missing.length) return false;
  for (const tx of missing) chargesAsked.add(tx.hash);
  let schedule: unknown = null;
  if (missing.some((tx) => tx.label !== 'mint'))
    try {
      schedule = await api<unknown>('/api/fee-schedule');
    } catch {
      for (const tx of missing) chargesAsked.delete(tx.hash);
      return false;
    }
  let changed = false;
  for (const tx of missing) {
    const fee = scheduledQlyphsFee(tx.label, tx.height!, schedule);
    if (fee === null || tx.qlyphsFee !== undefined) continue;
    tx.qlyphsFee = String(fee);
    changed = true;
  }
  return changed;
}
/** CoinGecko answers few requests per address: a price a minute and a chart per period every five
 * minutes are enough. When it refuses, the last answer stands in for half an hour; a refusal with
 * none is kept 30 s so the wallet does not insist. */
interface PriceRead<T> {
  at: number;
  value: Promise<T>;
  last?: { at: number; value: T };
}
const priceReads = new Map<string, PriceRead<unknown>>();
function priceRead<T>(key: string, fresh: number, read: () => Promise<T>): Promise<T> {
  const known = priceReads.get(key) as PriceRead<T> | undefined;
  if (known && Date.now() - known.at < fresh) return known.value;
  const entry: PriceRead<T> = { at: Date.now(), value: Promise.resolve() as Promise<T>, last: known?.last };
  entry.value = read().then(
    (value) => {
      entry.last = { at: Date.now(), value };
      return value;
    },
    (error: unknown) => {
      if (entry.last && Date.now() - entry.last.at < 30 * 60_000) return entry.last.value;
      entry.at = Date.now() - fresh + 30_000;
      throw error;
    },
  );
  priceReads.set(key, entry as PriceRead<unknown>);
  return entry.value;
}
/** The generic finality gate: nothing this account signed is unresolved in history. A running mint
 * session replaces it only for its own next lot (it holds the wallet meanwhile); every other
 * operation, and every operation after a session, goes through it. */
function requireSettledAccount(a: Account): void {
  requireThat(
    !state.transactions.some(
      (t) => t.owner === a.owner && t.genesis === a.genesis && !FINAL_STATUSES.includes(t.status),
    ),
    'Wait for the previous operation to finalize. Unknown submissions are never recreated',
  );
}
const NO_WALLET_ERROR = 'Create or import a wallet in Qlyphs Wallet, then connect again.';
let setupShownAt = -Infinity;
/** A site asking to connect before any wallet exists gets UNAUTHORIZED and the wallet opens its setup
 * page, at most once a minute so that a page cannot open tabs in a loop. */
function showSetup(): void {
  if (Date.now() - setupShownAt < 60_000) return;
  setupShownAt = Date.now();
  void Promise.resolve()
    .then(() => browser.tabs.create({ url: browser.runtime.getURL('ui.html?surface=tab') }))
    .catch(() => undefined);
}
async function createJob(
  kind: Job['kind'],
  connection: Connection | undefined,
  requestId: string | undefined,
  input?: unknown,
): Promise<string> {
  const a = account();
  if (kind !== 'connect') {
    requireThat(!walletBusy, 'Another operation is pending; finish it before trying again');
    requireThat(state.backed, 'Save and acknowledge your recovery backup first');
    if (connection) requireThat(permitted(connection), 'Connect this site first');
    walletBusy = true;
  }
  let inserted: string | undefined, job: Job | undefined;
  try {
    // Trigger real-deadline expiry before binding a new request to the epoch.
    void isUnlocked();
    job = {
      kind,
      owner: a.owner,
      genesis: a.genesis,
      epoch: session.epoch,
      connection,
      requestId,
      connectionRevision: connection?.revision,
      cancelled: false,
      phase: 'review',
      retips: 0,
      reply: connection && requestId ? (v) => send(connection, requestId, v) : () => undefined,
    };
    const doc: BoundDocument = connection ?? {
      origin: 'Qlyphs Wallet',
      tabId: -1,
      document: crypto.randomUUID(),
    };
    if (kind === 'signin') {
      requireThat(connection, 'Sign-in starts from a connected site');
      const challenge = input as string;
      // The origin is the connected document's, as the browser reported it; never the page's word.
      const fields = reviewSignIn(challenge, {
        origin: connection.origin,
        owner: a.owner,
        genesis: a.genesis,
        now: Date.now(),
      });
      job.signIn = {
        challenge,
        fields,
        digest: await digestOf({ origin: connection.origin, owner: a.owner, challenge }),
      };
    } else if (kind === 'vault') {
      requireThat(connection, 'Vault authorizations start from a connected site');
      const message = input as string;
      const publicKey = await siteVaultKey(a);
      job.solanaVault = {
        message,
        publicKey,
        review: await reviewSolanaVault(message, publicKey, a.owner),
        digest: await digestOf({ origin: connection.origin, owner: a.owner, message }),
      };
    } else if (kind === 'session') {
      requireThat(connection, 'Mint sessions start from a connected site');
      await history();
      requireSettledAccount(a);
      job.mintReview = await reviewMintSession(a, connection.origin, input as MintSessionTerms);
    } else if (kind === 'transaction') {
      await history();
      requireSettledAccount(a);
      const command = parseCommand(input);
      if (command.kind === 'buy')
        requireThat(pqConfigured(), 'Purchases disabled: no bundled PQ witness policy');
      // Mainnet runs progressive-1000-v2 and the fee schedule only from their reviewed activation,
      // and never v1: before it, a progressive deploy or lot, and any rate-derived fee, is refused
      // there.
      if (
        command.kind === 'deployProgressive' ||
        ((command.kind === 'deployProgressiveV2' || command.kind === 'mintProgressive') &&
          !mainnetReviewed())
      )
        requireThat(PROFILE.network !== 'mainnet', 'Progressive tokens are not enabled on mainnet');
      if (isRateDerived(command.kind))
        requireThat(PROFILE.network !== 'mainnet' || mainnetReviewed(), MAINNET_FEES_OFF);
      // A progressive mint is priced and built only from terms both witnesses attest.
      if (command.kind === 'mintProgressive')
        requireThat(pqConfigured(), 'Progressive mint disabled: no bundled PQ witness policy');
      // The terms come from both witnesses' attestation of a recent best block, which the mint's
      // signature will then commit to.
      const attested =
        command.kind === 'mintProgressive' ? await attestLot(a, command) : undefined;
      const quote =
        command.kind === 'deploy' ||
        command.kind === 'inscribe' ||
        command.kind === 'deployProgressive' ||
        command.kind === 'deployProgressiveV2'
          ? await quoteFor(a, command)
          : undefined;
      job.review = await prepare(state.manifest!, a.owner, input, attested, quote);
    } else await network(state.manifest!);
    current(job);
    const p = requests.add(doc, job);
    jobs.set(p.id, job);
    inserted = p.id;
    job.expires = p.expires;
    const url = browser.runtime.getURL('ui.html?request=' + p.id);
    const bound = job;
    // A new extension page may message us before windows.create() resolves.
    // Bind the authoritative window ID before serving any review/approval.
    // Keys opens a site's review in that site's own popup, never in another site's.
    job.windowReady = (async () => {
      const panel = connection ? await offerPanel(connection.tabId, p.id) : undefined;
      if (panel !== undefined) {
        bound.panel = true;
        return { id: panel };
      }
      return connection && browser.windows.openFor
        ? browser.windows.openFor(connection.tabId, url)
        : openReview(url, connection?.tabId);
    })().then((w) => {
      requireThat(w.id !== undefined, 'Confirmation window could not be opened');
      bound.windowId = w.id;
      if (bound.panel) void handPanelKey(p.id);
    });
    await job.windowReady;
    return p.id;
  } catch (e) {
    // A job cancelled meanwhile was already finished, which released the mutex: by now it may
    // belong to another operation.
    const owned = !inserted || jobs.get(inserted) === job;
    if (inserted) {
      requests.remove(inserted);
      jobs.delete(inserted);
    }
    if (kind !== 'connect' && owned) walletBusy = false;
    throw e;
  }
}
/** A review opens like the toolbar wallet: a small window in the top-right corner of the asking
 * page's browser window, under the extension icons. Without that window, the browser places it. */
const REVIEW_WIDTH = 360,
  REVIEW_HEIGHT = 640;
/** Chrome refuses bounds that are mostly off-screen (a window across two monitors): then the
 * browser places it. */
async function openReview(url: string, tabId?: number): Promise<{ id?: number }> {
  const placement = await reviewPlacement(tabId);
  try {
    return await browser.windows.create({ url, type: 'popup', ...placement });
  } catch (error) {
    if (placement.left === undefined) throw error;
    return browser.windows.create({ url, type: 'popup', width: REVIEW_WIDTH, height: REVIEW_HEIGHT });
  }
}
async function reviewPlacement(tabId?: number): Promise<{ width: number; height: number; left?: number; top?: number }> {
  const size = { width: REVIEW_WIDTH, height: REVIEW_HEIGHT };
  try {
    if (tabId === undefined || !browser.windows.get) return size;
    const tab = await browser.tabs.get(tabId);
    if (tab.windowId === undefined) return size;
    const w = await browser.windows.get(tab.windowId);
    if (w.state === 'fullscreen' || w.left === undefined || w.top === undefined || w.width === undefined)
      return size;
    return { ...size, left: Math.max(0, w.left + w.width - REVIEW_WIDTH), top: Math.max(0, w.top) };
  } catch {
    return size;
  }
}
/** Whether the active network has trusted witnesses. A switchable build only bundles a development
 * policy (build.mjs), so its mainnet side has none. */
// A single policy is the test network's: mainnet never uses it. A policy per network applies to its own.
const pqConfigured = (): boolean =>
  policyBundled() && (policyPerNetwork || !(SWITCHABLE && NETWORK === 'mainnet'));
/** The wallet's own price of a create or inscribe. With a fee schedule, only from both witnesses'
 * attestation of the best block, which the signature's era is then born at. */
async function quoteFor(a: Account, command: Parameters<typeof quoteFees>[0]): Promise<FeeQuote> {
  const rules = feeRulesFor(PROFILE.network);
  if (rules === null) return quoteFees(command, a.owner, a.genesis, null);
  const pinned = attestationPolicy();
  requireThat(pqConfigured() && pinned, FEES_UNVERIFIED_ERROR);
  let attested;
  try {
    attested = await attestedFees(a.owner, a.genesis, tipBlock, API + '/api/attestations/tip');
  } catch {
    throw Error(FEES_UNVERIFIED_ERROR);
  }
  return quoteFees(command, a.owner, a.genesis, rules, attested, pinned!.rulesHash);
}
// Qlyphs Keys reports whether its browser may run sessions (not mobile, WebKit or without a shared
// worker). A browser extension asks the runtime for its system instead: sessions only on desktop
// Windows, macOS or Linux. Until the answer arrives, and if it fails, sessions are off.
let browserRunsSessions = false;
const sessionBrowserKnown = (async () => {
  const keys = (browser.runtime as { mintSessionsSupported?: unknown }).mintSessionsSupported;
  if (keys !== undefined) {
    browserRunsSessions = keys === true;
    return;
  }
  try {
    browserRunsSessions = sessionPlatform((await browser.runtime.getPlatformInfo?.())?.os);
  } catch {
    browserRunsSessions = false;
  }
})();
// On mainnet a session pays progressive lots, so it needs the reviewed activation compiled in,
// exactly as a single lot mint does.
const mintSessionsAvailable = (): boolean =>
  browserRunsSessions &&
  (PROFILE.network !== 'mainnet' || mainnetReviewed()) &&
  sessionsAvailable(pqConfigured(), PROFILE.runtime.codeHash);
/** The lot terms `prepare` builds a payment from, all from both witnesses' attestation. */
const attestedTerms = (view: AttestedAsset, lot: NonNullable<AttestedAsset['next']>) => ({
  lot,
  symbol: view.symbol,
  decimals: view.decimals,
  cap: view.cap,
  minted: view.minted,
  creator: view.creator,
  block: { height: view.block.height, hash: view.block.hash },
});
/** The last lot a session may pay for, and its fee: v2 fees never decrease with the lot number, so
 * "fee at most maxFeePerLot", which every admission enforces, is "lot at most lastLot". */
function feeRange(first: number, maxFee: bigint): { lastLot: number; lastFee: string } {
  let lastLot = first,
    lastFee = progressiveLotFee(BigInt(first), PROGRESSIVE_MINT_PROFILE_V2);
  for (let lot = first + 1; lot <= Number(PROGRESSIVE_MINT_LOTS); lot++) {
    const fee = progressiveLotFee(BigInt(lot), PROGRESSIVE_MINT_PROFILE_V2);
    if (fee > maxFee) break;
    lastLot = lot;
    lastFee = fee;
  }
  return { lastLot, lastFee: String(lastFee) };
}
/** Drops settled session records, oldest first, until one more fits; returns the free slots. A
 * dropped record's settle task has nothing left to report. */
function pruneMintRecords(): number {
  const ledger = (state.mintSessions ??= []);
  const before = [...ledger];
  const free = pruneSettled(ledger, state.transactions);
  for (const record of before)
    if (!ledger.includes(record))
      for (const c of mintSettling) if (c.record === record) c.abortSettle();
  return free;
}
/**
 * The review of a proposed mint session: the token as both witnesses attest it at the node's best
 * block, one prepared lot (never signed: it checks the call, the block, the Qlyphs fee, the payer
 * and the native charge) and every bound the approval digest binds. Refusals are fixed messages
 * the site sees as VERIFICATION_FAILED.
 */
async function reviewMintSession(
  a: Account,
  origin: string,
  terms: MintSessionTerms,
  tip = '0',
): Promise<MintSessionReview> {
  parseTip(tip);
  requireThat(mintSessionsAvailable(), 'Mint sessions are not available on this network');
  const ticket = ticketCharge(PROFILE.runtime.codeHash);
  const pinned = attestationPolicy();
  requireThat(ticket !== null && pinned, 'Mint sessions are not available on this network');
  // Only other accounts' unsettled sessions can fill the ledger: this one's history is settled.
  const records = pruneMintRecords();
  requireThat(records >= 1, RECORDS_FULL);
  const view = await attestedAsset(
    a.owner,
    a.genesis,
    terms.asset,
    tipBlock,
    API + '/api/attestations/tip',
  );
  const next = view.next;
  requireThat(next, 'All lots of this token are minted');
  requireThat(
    view.profile === PROGRESSIVE_MINT_PROFILE_V2 && next.profile === PROGRESSIVE_MINT_PROFILE_V2,
    'This token uses another price schedule. Review it again.',
  );
  requireThat(
    view.lotSize === BigInt(terms.lotAmount) && next.amount === view.lotSize,
    'The lot size differs from the request',
  );
  requireThat(
    view.symbol.length <= 32 && Number.isSafeInteger(view.decimals) && view.decimals <= 18,
    'Invalid asset definition',
  );
  requireThat(
    next.fee <= BigInt(terms.maxFeePerLot),
    'The next lot costs more than the session allows',
  );
  requireThat(
    next.fee + ticket <= BigInt(terms.maxSpend),
    'The spend limit does not cover one lot',
  );
  const quote = await prepare(
    state.manifest!,
    a.owner,
    {
      kind: 'mintProgressive',
      asset: terms.asset,
      lot: Number(next.lot),
      profile: PROGRESSIVE_MINT_PROFILE_V2,
    },
    attestedTerms(view, next),
    undefined,
    tip,
  );
  requireThat(
    quote.intent.costs.nativeFee === String(ticket),
    'Unexpected native charge; signing disabled',
  );
  const networkFee = BigInt(quote.intent.costs.networkFee);
  const id = crypto.randomUUID();
  const asset = {
    id: terms.asset,
    symbol: view.symbol,
    decimals: view.decimals,
    cap: String(view.cap),
    creator: view.creator,
  };
  const start = {
    lot: Number(next.lot),
    fee: String(next.fee),
    minted: String(view.minted),
    block: { height: view.block.height, hash: view.block.hash },
  };
  const range = feeRange(start.lot, BigInt(terms.maxFeePerLot));
  const costs = {
    networkFee: String(networkFee),
    networkReserve: String(networkFee * BigInt(NETWORK_FEE_MARGIN)),
    ticket: String(ticket),
    margin: NETWORK_FEE_MARGIN,
  };
  const capacity = {
    remaining: JOURNAL_CAPACITY - state.transactions.length,
    needed: terms.maxLots + terms.maxAttempts,
    records,
  };
  const policy = {
    version: pinned.version,
    rulesHash: pinned.rulesHash,
    runtimeHash: pinned.runtimeHash,
  };
  const horizonBlocks = 256;
  // One fixed property order: the digest is over the JSON text.
  const digest = await digestOf({
    id,
    origin,
    owner: a.owner,
    genesis: a.genesis,
    terms,
    asset,
    start,
    range,
    costs,
    capacity,
    policy,
    horizonBlocks,
    ...(tip !== '0' ? { tip } : {}),
  });
  return {
    id,
    terms,
    asset,
    start,
    range,
    costs,
    capacity,
    policy,
    horizonBlocks,
    ...(tip !== '0' ? { tip } : {}),
    digest,
  };
}
async function reviewSender(sender: UISender, id: string): Promise<Job> {
  requireThat(
    sameExtensionPage(sender.url, root, '/ui.html') &&
      new URL(sender.url!).searchParams.get('request') === id,
    'Approval must come from its extension confirmation window',
  );
  const j = requests.get(id).value;
  await j.windowReady;
  requireThat(requests.get(id).value === j, 'Request context changed');
  current(j);
  const fromPanel = new URL(sender.url!).searchParams.get('surface') === 'sidebar';
  requireThat(fromPanel === !!j.panel, 'Wrong confirmation window');
  if (j.panel)
    requireThat(
      sender.tab === undefined && !!j.panelKey && sender.panelKey === j.panelKey,
      'Wrong confirmation window',
    );
  else if (sender.tab?.windowId !== undefined)
    requireThat(j.windowId === sender.tab.windowId, 'Wrong confirmation window');
  return j;
}
/** Both witnesses' terms for the next lot, at a recent best block the mint will then be signed on. */
function attestLot(a: Account, command: Extract<Command, { kind: 'mintProgressive' }>) {
  return attestedLot(a.owner, a.genesis, command.asset, command.lot, tipBlock, API + '/api/attestations/tip');
}
/** Review a mint session again with the tip every payment will carry: the next lot is attested
 * again and the new review has its own id and digest, so an approval of the old one is refused. */
async function retipSession(job: Job, tip: string): Promise<MintSessionReview> {
  requireThat(job.phase === 'review' && job.mintReview && job.connection, 'Invalid request');
  parseTip(tip);
  const turn = ++job.retips;
  const review = await reviewMintSession(account(), job.connection!.origin, job.mintReview!.terms, tip);
  current(job);
  requireThat(job.phase === 'review' && turn === job.retips, 'Review changed; approve the new request');
  job.mintReview = review;
  return review;
}
/** Prepare an operation again with the priority tip the user picked in its review: a new review
 * with a new digest, so an approval of the old one is refused. */
async function retip(id: string, tip: string, sender: Sender): Promise<Review | MintSessionReview> {
  const job = await reviewSender(sender, id);
  if (job.kind === 'session') return retipSession(job, tip);
  requireThat(job.kind === 'transaction' && job.phase === 'review' && job.review, 'Invalid request');
  const command = parseCommand(job.review!.command);
  requireThat(!isRateDerived(command.kind), NO_TIP_ERROR);
  parseTip(tip);
  const a = account();
  const turn = ++job.retips;
  // A lot mint is attested again; any other operation is prepared again from its command.
  const attested = command.kind === 'mintProgressive' ? await attestLot(a, command) : undefined;
  const review = await prepare(state.manifest!, a.owner, command, attested, undefined, tip);
  current(job);
  // A newer choice, or an approval that started meanwhile, wins over this one.
  requireThat(job.phase === 'review' && turn === job.retips, 'Review changed; approve the new request');
  job.review = review;
  return review;
}
async function approve(
  id: string,
  digest: string,
  sender: Sender,
  page?: unknown,
): Promise<unknown> {
  const job = await reviewSender(sender, id);
  // Two approvals of one review both get past the await above. Only the first claims it (each
  // handler below reaches `phase = 'signing'` before its own first await); a second is refused
  // here, before it could answer the site or release the mutex the first one still holds.
  requireThat(jobs.get(id) === job && job.phase === 'review', 'Request already approved');
  // A session keeps the wallet mutex after its approval: it never reaches the finally below.
  if (job.kind === 'session') return approveSession(job, id, digest, page, sender);
  requireThat(page === undefined, 'Invalid approval');
  if (job.kind === 'signin') return approveSignIn(job, id, digest);
  if (job.kind === 'vault') return approveSolanaVault(job, id, digest);
  if (job.kind === 'connect') {
    requireThat(isUnlocked() && session.epoch === job.epoch, 'Unlock wallet first');
    requireThat(digest === 'connect', 'Invalid connection approval');
    requests.consume(id);
    job.phase = 'signing';
    current(job);
    const c = job.connection!,
      grants = state.grants;
    pendingGrants.add(c.origin);
    try {
      grants[c.origin] = { owner: job.owner, genesis: job.genesis };
      await save();
      current(job);
      requireThat(isUnlocked() && session.epoch === job.epoch, 'Unlock wallet first');
      pendingGrants.delete(c.origin);
      const result = [account()];
      finish(id, { result });
      return { connected: true };
    } catch {
      delete grants[c.origin];
      await save().catch(() => undefined);
      finish(id, { error: publicError(null, 'CONTEXT_CHANGED', 'not-submitted') });
      throw Error('Connection cancelled or could not be saved');
    } finally {
      pendingGrants.delete(c.origin);
      publishStates();
    }
  }
  const review = job.review!;
  let tx: Transaction | undefined;
  try {
    // Stale reviews must release the provider request and wallet mutex immediately.
    requireThat(review.digest === digest, 'Review changed; approve the new request');
    requireThat(
      isUnlocked() && session.epoch === job.epoch,
      'Wallet locked; unlock and request a new review',
    );
    requests.consume(id);
    job.phase = 'signing';
    await recheck(review, state.manifest!, account().address);
    current(job);
    requireThat(Date.now() < review.intent.expiresAt, 'Review expired');
    const signer = await wasm();
    current(job);
    if (review.command.kind === 'buy') {
      // The extension owns the challenge, pinned keys and high-water storage.
      // The dapp's claimed verification/status cannot bypass this check.
      await authorizePurchase(
        review.intent.callHex,
        job.owner,
        job.genesis,
        API + '/api/attestations',
      );
      current(job);
    }
    requireThat(Date.now() < review.intent.expiresAt, 'Review expired during verification');
    const selectedClear = await walletClear(state.vault!, job.epoch);
    let phrase: string;
    try {
      phrase = new TextDecoder().decode(selectedClear);
    } finally {
      selectedClear.fill(0);
    }
    stillUnlocked(job.epoch);
    current(job);
    requireThat(Date.now() < review.intent.expiresAt, 'Review expired during verification');
    // Synchronous signing: no asynchronous boundary between the last authorization
    // check and use of the secret. Unknown sign failures are never logged verbatim.
    let signed: Uint8Array;
    try {
      signed = signer.signCallFromMnemonic(
        phrase,
        fromHex(review.intent.callHex),
        signingContext(review),
        state.derived?.index ?? 0,
        0,
        0,
      );
    } catch {
      throw Error('Local signature failed');
    }
    const parsed = parseSignedExtrinsic(signed);
    requireThat(
      parsed.scheme === 'ml-dsa-87' &&
        hex(parsed.accountId) === job.owner &&
        hex(parsed.call) === review.intent.callHex &&
        parsed.nonce === review.intent.context.nonce &&
        parsed.tip === BigInt(review.tip ?? '0'),
      'SDK signature output failed validation',
    );
    const hash = extrinsicHash(signed);
    tx = {
      hash,
      owner: job.owner,
      genesis: job.genesis,
      nonce: review.intent.context.nonce,
      intentId: review.intent.id,
      createdAt: Date.now(),
      label: String(review.command.kind),
      status: 'signed-not-submitted',
      validUntil: review.intent.context.blockNumber + review.intent.context.period,
      ...transferDisplay(review),
      fee: String(BigInt(review.intent.costs.networkFee) + BigInt(review.tip ?? '0')),
      ...reviewedCharges(review),
    };
    requireThat(
      state.transactions.length < 200,
      'Archive capacity reached; preserve history before continuing',
    );
    state.transactions.unshift(tx);
    // Persist identity/hash before any broadcast. Never persist the phrase or raw signature.
    await save();
    current(job);
    stillUnlocked(job.epoch);
    tx.status = 'broadcast-uncertain';
    await save();
    current(job);
    stillUnlocked(job.epoch);
    // A tipped transaction goes to the node itself: the service relays only tip 0.
    const submitted = await submitOnce(hash, () =>
      review.tip
        ? submitToNode(hex(signed), hash)
        : api('/api/submit', { id: review.intent.id, raw: hex(signed) }),
    );
    tx.status = submitted.status;
    await save();
    const result = {
      hash,
      // History reconciliation can mutate tx while storage is awaiting IO.
      // A submission acknowledgment is immutable, not an inclusion status.
      status: submitted.status,
      ...(review.command.kind === 'deploy' ||
      review.command.kind === 'deployProgressive' ||
      review.command.kind === 'deployProgressiveV2' ||
      review.command.kind === 'inscribe'
        ? { asset: assetId(job.owner, BigInt(review.intent.sequence)) }
        : {}),
    };
    finish(id, { result });
    return result;
  } catch (error) {
    if (tx && tx.status === 'signed-not-submitted') {
      tx.status = 'cancelled-before-broadcast';
      await save();
    }
    // The site learns why as a public reason code only; the outcome is this wallet's own record,
    // whatever the error says.
    finish(id, {
      error: publicError(
        null,
        'VERIFICATION_FAILED',
        tx && tx.status !== 'cancelled-before-broadcast' ? 'unknown' : 'not-submitted',
        reasonOf(error),
      ),
    });
    throw Error(uiError(error), { cause: error });
  } finally {
    walletBusy = false;
  }
}
/**
 * Signs an approved site sign-in and answers its site with the proof. Nothing is broadcast and no
 * funds move, so a failure has no outcome to report beyond the refusal itself.
 */
async function approveSignIn(job: Job, id: string, digest: string): Promise<unknown> {
  try {
    const review = job.signIn!;
    requireThat(review.digest === digest, 'Review changed; approve the new request');
    requireThat(
      isUnlocked() && session.epoch === job.epoch,
      'Wallet locked; unlock and request a new review',
    );
    requests.consume(id);
    job.phase = 'signing';
    current(job);
    const signer = await wasm();
    current(job);
    const selectedClear = await walletClear(state.vault!, job.epoch);
    let phrase: string;
    try {
      phrase = new TextDecoder().decode(selectedClear);
    } finally {
      selectedClear.fill(0);
    }
    stillUnlocked(job.epoch);
    current(job);
    // Checked again at signing time: the review may have stayed open while the session ran out.
    const fields = reviewSignIn(review.challenge, {
      origin: job.connection!.origin,
      owner: job.owner,
      genesis: job.genesis,
      now: Date.now(),
    });
    const key = signer.accountFromMnemonic(requireMnemonic(phrase), state.derived?.index ?? 0, 0, 0);
    const proof = signSignIn(key, job.owner, fields);
    finish(id, { result: proof });
    return { signedIn: true };
  } catch (error) {
    finish(id, { error: publicError(null, 'VERIFICATION_FAILED', undefined, reasonOf(error)) });
    throw Error(uiError(error), { cause: error });
  } finally {
    walletBusy = false;
  }
}
/**
 * The active account's Solana vault public key, derived only on the person's own action: unlock,
 * account switch, backup acknowledgement (rememberVaultKey). A site's request only reads it: deriving
 * it then would open the recovery phrase on a site's word. It counts for its account and epoch only,
 * which every lock, expiry and account switch moves (and `ended` drops it). Public data.
 */
let vaultKey: { owner: string; epoch: number; key: Uint8Array } | null = null;
/** The derivation the last of those actions started; it never rejects. A site's request that
 * arrives meanwhile waits for it rather than being refused, and never starts one itself. */
let vaultKeyPending: Promise<void> = Promise.resolve();
/** Starts deriving and keeping the vault key of the active account, in a build serving the vault
 * methods, once the wallet is unlocked and backed up. Called from the extension's own handlers only,
 * which do not wait for it: the derivation opens its own copy of the phrase, so theirs is wiped at
 * once. A failure keeps no key: a site asking for it is told to unlock again. */
function rememberVaultKey(): void {
  vaultKeyPending = deriveVaultKey();
}
async function deriveVaultKey(): Promise<void> {
  try {
    if (!SOLANA_VAULT || !state.backed || !isUnlocked()) return;
    const a = account(),
      epoch = session.epoch,
      index = state.derived?.index ?? 0;
    const signer = await wasm();
    const clear = await walletClear(state.vault!, epoch);
    let phrase: string;
    try {
      phrase = new TextDecoder().decode(clear);
    } finally {
      clear.fill(0);
    }
    if (session.epoch !== epoch || account().owner !== a.owner) return;
    const key = publicKeyOf(signer.accountFromMnemonic(requireMnemonic(phrase), index, 0, 0), a.owner);
    if (isUnlocked() && session.epoch === epoch) vaultKey = { owner: a.owner, epoch, key };
  } catch {
    /* no key kept */
  }
}
/** Installs an unlock the person just proved (password, passkey, a new wallet) and derives the
 * vault key on that same action. */
function installUnlock(clear: Uint8Array, epoch: number, ready: boolean): void {
  session.install(clear, epoch);
  stayAwake();
  accessReady = ready;
  rememberVaultKey();
}
/** The vault key for a site's request, which has checked the unlock: the one kept for this account
 * and unlock, or a refusal that names the person's next step. */
async function siteVaultKey(a: Account): Promise<Uint8Array> {
  if (!state.backed)
    throw new QlyphsError('UNAUTHORIZED', 'Save and acknowledge your recovery backup first');
  // Until no newer derivation has started: one begun while this waited is the one that counts.
  for (let p = vaultKeyPending; ; p = vaultKeyPending) {
    await p;
    if (p === vaultKeyPending) break;
  }
  if (!vaultKey || vaultKey.owner !== a.owner || vaultKey.epoch !== session.epoch || !isUnlocked())
    throw new QlyphsError('UNAUTHORIZED', 'Unlock wallet first', undefined, 'wallet-locked');
  return vaultKey.key.slice();
}
/**
 * Signs an approved Solana vault authorization and answers its site with the signature. Nothing is
 * broadcast here: the site submits it. A failure has no outcome to report beyond the refusal.
 */
async function approveSolanaVault(job: Job, id: string, digest: string): Promise<unknown> {
  try {
    const review = job.solanaVault!;
    requireThat(review.digest === digest, 'Review changed; approve the new request');
    requireThat(
      isUnlocked() && session.epoch === job.epoch,
      'Wallet locked; unlock and request a new review',
    );
    requests.consume(id);
    job.phase = 'signing';
    current(job);
    // Checked again at approval, against the same key: nothing the review showed has changed. The
    // phrase is opened only after this network read, so the unlock deadline is read after it.
    await reviewSolanaVault(review.message, review.publicKey, job.owner);
    current(job);
    const signer = await wasm();
    current(job);
    const selectedClear = await walletClear(state.vault!, job.epoch);
    let phrase: string;
    try {
      phrase = new TextDecoder().decode(selectedClear);
    } finally {
      selectedClear.fill(0);
    }
    // From here to the signature nothing awaits.
    stillUnlocked(job.epoch);
    current(job);
    const key = signer.accountFromMnemonic(requireMnemonic(phrase), state.derived?.index ?? 0, 0, 0);
    const signature = signSolanaVault(key, job.owner, review.publicKey, review.message);
    finish(id, { result: signature });
    return { signed: true };
  } catch (error) {
    finish(id, { error: publicError(null, 'VERIFICATION_FAILED', undefined, reasonOf(error)) });
    throw Error(uiError(error), { cause: error });
  } finally {
    walletBusy = false;
  }
}
/**
 * Starts an approved mint session and answers its site with the running snapshot; the session
 * keeps the wallet mutex until its `run()` settles. Every refusal finishes the job (not submitted)
 * and releases the mutex: `cancel()` never finishes a consumed job, so a refusal that skipped this
 * would keep both until a restart.
 */
async function approveSession(
  job: Job,
  id: string,
  digest: string,
  page: unknown,
  sender: Sender,
): Promise<unknown> {
  const review = job.mintReview!;
  const refuse = (code: PublicErrorCode, error: unknown): never => {
    finish(id, { error: publicError(null, code, 'not-submitted', reasonOf(error)) });
    walletBusy = false;
    publishStates();
    throw error instanceof Error ? error : Error('Request cancelled or session changed');
  };
  if (typeof page !== 'string' || !SESSION_ID.test(page))
    return refuse('VERIFICATION_FAILED', Error('Invalid approval'));
  if (digest !== review.digest)
    return refuse('VERIFICATION_FAILED', Error('Review changed; approve the new request'));
  if (!(isUnlocked() && session.epoch === job.epoch))
    return refuse('CONTEXT_CHANGED', Error('Wallet locked; unlock and request a new review'));
  // The signing deadline is fixed now and never extended: the approved duration, clamped by the
  // unlock deadline.
  const approvedAt = Date.now(),
    unlockDeadline = session.deadline,
    deadline = Math.min(approvedAt + review.terms.maxDurationSeconds * 1000, unlockDeadline);
  if (deadline - approvedAt < MIN_START_MS) return refuse('CONTEXT_CHANGED', Error(LOCKS_TOO_SOON));
  try {
    requests.consume(id);
  } catch (error) {
    return refuse('CONTEXT_CHANGED', error);
  }
  job.phase = 'signing';
  // Until the session starts, a reload of this window cancels the approval (`abandonStart`).
  job.approval = { page, documentId: sender.documentId };
  if (JOURNAL_CAPACITY - state.transactions.length < review.capacity.needed)
    return refuse('VERIFICATION_FAILED', Error(ARCHIVE_FULL));
  if (pruneMintRecords() < 1) return refuse('VERIFICATION_FAILED', Error(RECORDS_FULL));
  const key = job.genesis + ':' + job.owner,
    connection = job.connection;
  if (!connection) return refuse('CONTEXT_CHANGED', Error('Site permission revoked'));
  // The mutex already prevents a second session of this account; this keeps it explicit.
  if (mintControllers.has(key))
    return refuse('BUSY', Error('Another operation is pending; finish it before trying again'));
  const runtime = PROFILE.runtime.codeHash,
    ticket = ticketCharge(runtime);
  if (ticket === null)
    return refuse('VERIFICATION_FAILED', Error('Unsupported runtime; signing disabled'));
  // Write A. A running record of this account without a controller lost its end write: it ends
  // here, in the same write as the new record.
  const ledger = (state.mintSessions ??= []);
  endStale(ledger, state.transactions, job.owner, job.genesis, approvedAt);
  const record: MintSessionRecord = {
    id: review.id,
    origin: connection.origin,
    owner: job.owner,
    genesis: job.genesis,
    terms: review.terms,
    digest: review.digest,
    runtime,
    ticket: String(ticket),
    margin: NETWORK_FEE_MARGIN,
    ...(review.tip ? { tip: review.tip } : {}),
    symbol: review.asset.symbol,
    decimals: review.asset.decimals,
    approvedAt,
    deadline,
    state: 'running',
    reason: null,
    endedAt: null,
    used: 0,
    reorganized: false,
    attempts: [],
  };
  ledger.push(record);
  try {
    await save();
  } catch (error) {
    ledger.splice(ledger.indexOf(record), 1);
    return refuse('VERIFICATION_FAILED', error);
  }
  try {
    current(job);
  } catch (error) {
    // Nothing was signed: the record ends at once.
    record.state = 'ended';
    record.reason = 'cancelled';
    record.endedAt = Date.now();
    await save().catch(() => undefined);
    return refuse('CONTEXT_CHANGED', error);
  }
  const binding: MintBinding = {
    connection,
    revision: job.connectionRevision!,
    requestId: id,
    windowId: job.windowId!,
    panelKey: job.panelKey,
    documentId: sender.documentId,
    page,
    epoch: job.epoch,
    owner: job.owner,
    address: account().address,
    genesis: job.genesis,
    deadline,
    unlockDeadline,
    lease: Date.now() + LEASE_MS,
    windowGone: false,
  };
  const controller = new MintSessionController(record, mintDeps(binding, record), {
    unlockDeadline,
  });
  const run: MintRun = { controller, binding };
  mintControllers.set(key, run);
  mintWindows.set(id, run);
  connection.mint = run;
  watchUpdates();
  finish(id, { result: controller.snapshot() }, false);
  publishMint(connection);
  // run() never rejects and resolves only after the end write was attempted.
  void controller.run().finally(() => {
    if (mintControllers.get(key) === run) mintControllers.delete(key);
    unwatchUpdates();
    walletBusy = false;
    const settling = controller.settling;
    if (settling) {
      mintSettling.add(controller);
      void settling.finally(() => mintSettling.delete(controller));
    }
    publishStates();
  });
  return { session: controller.view() };
}
/** Why a session's signing authority is gone (lock, account, channel, grant, window, deadline), or
 * null while it holds. The controller checks it right before each reservation, signature and
 * release; its own stop reason comes first. */
function mintAuthority(b: MintBinding): WalletEndReason | null {
  void isUnlocked(); // applies the absolute unlock deadline
  if (session.epoch !== b.epoch || !isUnlocked()) return 'locked';
  if (!state.vault || !state.manifest) return 'reset';
  const a = account();
  if (a.owner !== b.owner || a.genesis !== b.genesis) return 'account';
  if (!b.connection.alive) return 'disconnected';
  if (b.connection.revision !== b.revision || !permitted(b.connection)) return 'revoked';
  if (b.windowGone || Date.now() > b.lease) return 'window';
  if (Date.now() >= b.deadline) return b.deadline >= b.unlockDeadline ? 'locked' : 'deadline';
  return null;
}
const journalFinal = (hash: string): boolean =>
  state.transactions.some((t) => t.hash === hash && FINAL_STATUSES.includes(t.status));
const journalNeverRan = (hash: string): boolean =>
  state.transactions.some((t) => t.hash === hash && NEVER_RAN_JOURNAL.includes(t.status));
/** What a session does outside its memory, each effect through the wallet's own checked paths. */
function mintDeps(b: MintBinding, record: MintSessionRecord): SessionDeps {
  const asset = record.terms.asset;
  const attest = (latest: () => Promise<{ height: number; hash: string }>, signal: AbortSignal) =>
    attestedAsset(b.owner, b.genesis, asset, latest, API + '/api/attestations/tip', signal);
  return {
    now: () => Date.now(),
    sleep: (ms, signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, ms);
        signal.addEventListener('abort', done, { once: true });
      }),
    authority: () => mintAuthority(b),
    chain: chainReads(b.owner),
    proofs: { onAncestry, proveLineage, findInclusion, locatePayment, proveInclusion },
    attestTip: (signal) => attest(tipBlock, signal),
    attestAt: (block, signal) => attest(() => Promise.resolve(block), signal),
    async prepare(view): Promise<Quote> {
      const next = view.next;
      requireThat(next, 'All lots of this token are minted');
      const review = await prepare(
        state.manifest!,
        b.owner,
        {
          kind: 'mintProgressive',
          asset,
          lot: Number(next.lot),
          profile: PROGRESSIVE_MINT_PROFILE_V2,
        },
        attestedTerms(view, next),
        undefined,
        // The recheck then counts the tip in the payer's balance; the context stays the service's.
        record.tip ?? '0',
      );
      const i = review.intent;
      return {
        review,
        intentId: i.id,
        callHex: i.callHex,
        context: i.context,
        expiresAt: i.expiresAt,
        networkFee: BigInt(i.costs.networkFee),
        nativeFee: BigInt(i.costs.nativeFee),
        platformFee: BigInt(i.costs.platformFee),
        existentialDeposit: BigInt(i.costs.existentialDeposit),
      };
    },
    recheck: (quote) => recheck(quote.review as Review, state.manifest!, b.address),
    async unlockSigner() {
      const signer = await wasm();
      const clear = await walletClear(state.vault!, b.epoch);
      let phrase: string;
      try {
        phrase = new TextDecoder().decode(clear);
      } finally {
        clear.fill(0);
      }
      // Refuses once the wallet locked during the linked-wallet await.
      stillUnlocked(b.epoch);
      const index = state.derived?.index ?? 0;
      return (callHex, context) =>
        signer.signCallFromMnemonic(phrase, fromHex(callHex), context, index, 0, 0);
    },
    inspect(bytes) {
      const p = parseSignedExtrinsic(bytes);
      return {
        scheme: p.scheme,
        accountId: hex(p.accountId),
        callHex: hex(p.call),
        nonce: p.nonce,
        tip: p.tip,
        eraHex: hex(p.eraBytes),
        hash: extrinsicHash(bytes),
      };
    },
    era,
    // Exactly one transport call, never raced: a lost answer leaves the payment uncertain.
    submit: async (intentId, hash, bytes, tipped) =>
      (
        await submitOnce(hash, () =>
          tipped ? submitToNode(hex(bytes), hash) : api('/api/submit', { id: intentId, raw: hex(bytes) }),
        )
      ).status,
    journalFull: () => state.transactions.length >= JOURNAL_CAPACITY,
    journalAdd: (entry) => void state.transactions.unshift({ ...entry }),
    journalStatus(hash, status) {
      const tx = state.transactions.find((t) => t.hash === hash);
      if (tx) tx.status = status;
    },
    journalFinal,
    journalNeverRan,
    // The phrase and the signed bytes are never part of what is saved.
    persist: () => save(),
    changed: () => publishMint(b.connection),
  };
}
/** Every revocation hook: ends signing for the running sessions `which` selects. The first reason
 * a session receives is the one it ends with; payments already released are not affected. */
function stopMintSessions(
  reason: WalletEndReason,
  which: (b: MintBinding) => boolean = () => true,
): void {
  for (const run of mintControllers.values()) if (which(run.binding)) run.controller.stop(reason);
}
function within(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work.then(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
/** Stops every running session and waits, at most `ms`, until each has recorded its end. */
async function stopMintSessionsAndWait(reason: WalletEndReason, ms: number): Promise<void> {
  const runs = [...mintControllers.values()];
  if (!runs.length) return;
  for (const run of runs) run.controller.stop(reason);
  await within(Promise.all(runs.map((run) => run.controller.run())), ms);
}
/** Ends the read-only settle tasks: a reset, a network switch or an update leaves them nothing. */
function abortMintSettling(): void {
  for (const controller of mintSettling) controller.abortSettle();
}
let updateListener: ((details: { version: string }) => void) | undefined,
  updating = false;
/** Listens for updates only while a session runs: a listener makes Firefox keep the old version
 * until the extension reloads, which `applyUpdate` then does. */
function watchUpdates(): void {
  const event = browser.runtime.onUpdateAvailable;
  if (!event || updateListener) return;
  updateListener = () => void applyUpdate();
  event.addListener(updateListener);
}
function unwatchUpdates(): void {
  if (mintControllers.size || !updateListener) return;
  browser.runtime.onUpdateAvailable?.removeListener(updateListener);
  updateListener = undefined;
}
/** An update revokes every session: each stops and records its end, then the extension reloads so
 * that the new version installs at once. Keys cannot reload; its page tells the user instead. */
async function applyUpdate(): Promise<void> {
  if (updating) return;
  updating = true;
  try {
    abortMintSettling();
    await stopMintSessionsAndWait('update', UPDATE_SETTLE_MS);
    // A session that was already ending may have started its settle task meanwhile.
    abortMintSettling();
    browser.runtime.reload?.();
  } finally {
    updating = false;
  }
}
/** The running session, or the latest ended one, whose id is `id`. */
function mintRunById(id: string): MintRun | undefined {
  for (const run of [...mintControllers.values(), ...mintWindows.values()])
    if (run.controller.record.id === id) return run;
  return undefined;
}
/** Whether a message comes from a page of `request`'s confirmation window, with a page token. */
const confirmationPage = (sender: Sender, request: unknown, page: unknown): boolean =>
  typeof request === 'string' &&
  SESSION_ID.test(request) &&
  typeof page === 'string' &&
  SESSION_ID.test(page) &&
  sameExtensionPage(sender.url, root, '/ui.html') &&
  new URL(sender.url!).searchParams.get('request') === request;
/** Whether a UI message comes from the surface a request or session is bound to: its window, or in
 * the side panel, the panel page that holds its key. */
function fromBoundSurface(sender: UISender, bound: { windowId?: number; panelKey?: string }): boolean {
  if (bound.panelKey !== undefined) return sender.tab === undefined && sender.panelKey === bound.panelKey;
  return sender.tab?.windowId !== undefined && sender.tab.windowId === bound.windowId;
}
/** The session a progress window follows: the sender must be the window its approval came from. */
function mintWindow(sender: UISender, request: unknown, page: unknown): MintRun {
  requireThat(confirmationPage(sender, request, page), NO_SESSION);
  const run = mintWindows.get(request as string);
  requireThat(
    run && fromBoundSurface(sender, run.binding),
    NO_SESSION,
  );
  const ended = run!.controller.record.endedAt;
  if (ended !== null && Date.now() - ended > ENDED_RETENTION_MS) {
    mintWindows.delete(request as string);
    throw Error(NO_SESSION);
  }
  return run!;
}
/** The page that approved, in its first document: another one in the same window is a reload. */
const approvedPage = (
  approval: { page: string; documentId?: string },
  sender: Sender,
  page: unknown,
): boolean =>
  page === approval.page &&
  (approval.documentId === undefined || sender.documentId === approval.documentId);
/**
 * An approval whose session has not started yet, because its record is still being saved, is
 * cancelled as a reload stops a running session: when another page of its window asks for the
 * session, or when a page of its window leaves. The approval then refuses once the save completes,
 * so nothing is signed, and the window's next page learns why.
 */
function abandonStart(sender: UISender, request: unknown, page: unknown, leaving: boolean): void {
  if (!confirmationPage(sender, request, page)) return;
  const job = jobs.get(request as string);
  if (!job?.approval || !fromBoundSurface(sender, job)) return;
  if (!leaving && approvedPage(job.approval, sender, page)) return;
  job.cancelled = true;
  const now = Date.now();
  for (const [id, a] of abandonedStarts) if (now >= a.expires) abandonedStarts.delete(id);
  abandonedStarts.set(request as string, {
    windowId: job.windowId!,
    panelKey: job.panelKey,
    expires: job.expires ?? 0,
  });
}
/** Whether this window abandoned its approval of `request` before the session started. */
function startAbandoned(sender: UISender, request: unknown, page: unknown): boolean {
  const a = confirmationPage(sender, request, page)
    ? abandonedStarts.get(request as string)
    : undefined;
  return !!a && Date.now() < a.expires && fromBoundSurface(sender, a);
}
/** The selected account's running session, else its latest ended one whose payments are not all
 * final in history: what the wallet's tracker follows. */
function mintStatus(): MintSessionStatus | null {
  if (!state.vault || !state.manifest) return null;
  const a = account();
  const run = mintControllers.get(a.genesis + ':' + a.owner);
  const record =
    run?.controller.record ??
    [...(state.mintSessions ?? [])]
      .reverse()
      .find(
        (r) =>
          r.owner === a.owner &&
          r.genesis === a.genesis &&
          r.state === 'ended' &&
          !settledRecord(r, state.transactions),
      );
  if (!record) return null;
  const snapshot = run
    ? run.controller.snapshot()
    : sessionSnapshot(record, journalFinal, 'running', journalNeverRan);
  return {
    id: record.id,
    state: snapshot.state,
    reason: record.reason,
    symbol: record.symbol,
    included: snapshot.lots.included,
    maxLots: record.terms.maxLots,
    used: record.used,
    maxAttempts: record.terms.maxAttempts,
    deadline: record.deadline,
    // Released and not in a block yet: it can still be included.
    outstanding: snapshot.pending !== null && snapshot.pending.status !== 'included',
    reorganized: record.reorganized,
  };
}
async function handlePage(c: Connection, input: unknown): Promise<void> {
  let r: Request | undefined;
  try {
    await loaded;
    await sessionBrowserKnown;
    requireThat(c.alive, 'Document is no longer active');
    if (!DAPPS.includes(c.origin))
      throw new QlyphsError('UNAUTHORIZED', 'This site is not allowed on the active network', 'not-submitted');
    if (Date.now() > c.reset) {
      c.count = 0;
      c.reset = Date.now() + 60000;
    }
    if (++c.count > 120) throw new QlyphsError('BUSY', 'Request rate exceeded', 'not-submitted');
    try {
      r = parseRequest(input);
    } catch {
      throw new QlyphsError('INVALID_REQUEST', 'Invalid request', 'not-submitted');
    }
    if (c.ids.has(r.id)) {
      c.alive = false;
      stopMintSessions('disconnected', (b) => b.connection === c);
      invalidate((j) => j.connection === c);
      connections.delete(c);
      c.port.disconnect();
      throw new QlyphsError(
        'CONTEXT_CHANGED',
        'Duplicate request invalidated channel',
        'not-submitted',
      );
    }
    if (c.ids.size >= 8 && r.method !== 'cancelRequest')
      throw new QlyphsError('BUSY', 'Too many outstanding requests', 'not-submitted');
    c.ids.add(r.id);
    // Builds without witness pins or a pinned ticket charge, mainnet builds without the reviewed
    // activation, and unsupported browsers neither advertise nor serve mint sessions.
    if (
      (r.method === 'requestMintSession' ||
        r.method === 'mintSession' ||
        r.method === 'stopMintSession') &&
      !mintSessionsAvailable()
    )
      throw new QlyphsError(
        'UNSUPPORTED_METHOD',
        'Mint sessions are not available on this network',
        r.method === 'requestMintSession' ? 'not-submitted' : undefined,
      );
    if (!SOLANA_VAULT && (SOLANA_VAULT_METHODS as readonly string[]).includes(r.method))
      throw new QlyphsError('UNSUPPORTED_METHOD', 'Unsupported wallet method', undefined, 'not-available');
    switch (r.method) {
      case 'capabilities':
        send(c, r.id, {
          result: capabilities(
            PROFILE.network,
            mintSessionsAvailable() ? MINT_SESSION_LIMITS : null,
            SOLANA_VAULT,
          ),
        });
        break;
      case 'state': {
        c.subscribed = true;
        const snapshot = projected(c);
        c.snapshot = JSON.stringify(snapshot);
        send(c, r.id, { result: snapshot });
        break;
      }
      case 'accounts':
        send(c, r.id, { result: projected(c).accounts });
        break;
      case 'network':
        send(c, r.id, { result: state.manifest ?? null });
        break;
      case 'disconnect':
        await revokeOrigin(c.origin);
        send(c, r.id, { result: true });
        break;
      case 'cancelRequest':
        // Only this browser-owned document's request IDs can be cancelled.
        for (const [id, job] of jobs)
          if (job.connection === c && job.requestId === r.target) cancel(id, 'ABORTED');
        if (r.target) c.ids.delete(r.target); // also invalidates preparation before job insertion
        send(c, r.id, { result: true });
        break;
      case 'connect':
        if (!state.vault || !state.manifest) {
          showSetup();
          throw new QlyphsError('UNAUTHORIZED', NO_WALLET_ERROR);
        }
        if (permitted(c) && isUnlocked()) send(c, r.id, { result: [account()] });
        else await createJob('connect', c, r.id);
        break;
      case 'requestTransaction': {
        const a = state.vault && state.manifest ? account() : null;
        if (!a || !permitted(c) || r.params?.owner !== a.owner || r.params.genesis !== a.genesis)
          throw new QlyphsError(
            'UNAUTHORIZED',
            'Wrong account, network or permission',
            'not-submitted',
          );
        if (walletBusy)
          throw new QlyphsError('BUSY', 'Another operation is pending', 'not-submitted');
        await createJob('transaction', c, r.id, r.params.command);
        break;
      }
      case 'requestMintSession': {
        // The same account, network and permission checks as a transaction request.
        const a = state.vault && state.manifest ? account() : null;
        if (!a || !permitted(c) || r.params.owner !== a.owner || r.params.genesis !== a.genesis)
          throw new QlyphsError(
            'UNAUTHORIZED',
            'Wrong account, network or permission',
            'not-submitted',
          );
        if (walletBusy)
          throw new QlyphsError('BUSY', 'Another operation is pending', 'not-submitted');
        await createJob('session', c, r.id, r.params.terms);
        break;
      }
      case 'signSessionChallenge': {
        const a = state.vault && state.manifest ? account() : null;
        if (!a || !permitted(c))
          throw new QlyphsError('UNAUTHORIZED', 'Wrong account, network or permission');
        if (walletBusy) throw new QlyphsError('BUSY', 'Another operation is pending');
        // Refused before any window opens: a request for another site, account, network or time
        // never reaches the person.
        try {
          reviewSignIn(r.params.challenge, {
            origin: c.origin,
            owner: a.owner,
            genesis: a.genesis,
            now: Date.now(),
          });
        } catch {
          throw new QlyphsError('INVALID_REQUEST', 'Invalid sign-in request');
        }
        await createJob('signin', c, r.id, r.params.challenge);
        break;
      }
      case 'solanaVaultPublicKey': {
        const a = state.vault && state.manifest ? account() : null;
        if (!a || !permitted(c))
          throw new QlyphsError('UNAUTHORIZED', 'Wrong account, network or permission');
        if (!isUnlocked()) throw new QlyphsError('UNAUTHORIZED', 'Unlock wallet first');
        const publicKey = await siteVaultKey(a);
        const vault = base58(solanaVaultBytes(await solanaVaultAddress(publicKey), 32));
        // The account may have changed while the address was hashed: answer only for the one asked.
        if (!c.alive || !permitted(c) || account().owner !== a.owner)
          throw new QlyphsError('CONTEXT_CHANGED', 'Account context changed');
        send(c, r.id, { result: { address: a.address, publicKey: hex(publicKey), vault } });
        break;
      }
      case 'signSolanaVaultAuthorization': {
        const a = state.vault && state.manifest ? account() : null;
        if (!a || !permitted(c))
          throw new QlyphsError('UNAUTHORIZED', 'Wrong account, network or permission');
        if (!isUnlocked()) throw new QlyphsError('UNAUTHORIZED', 'Unlock wallet first');
        if (walletBusy) throw new QlyphsError('BUSY', 'Another operation is pending');
        if (!state.backed)
          throw new QlyphsError('UNAUTHORIZED', 'Save and acknowledge your recovery backup first');
        // Refused before any window opens: a message for another program, network, vault or
        // lifetime never reaches the person.
        const publicKey = await siteVaultKey(a);
        try {
          await reviewSolanaVault(r.params.message, publicKey, a.owner);
        } catch {
          throw new QlyphsError('INVALID_REQUEST', 'Invalid vault authorization');
        }
        // Another request may have taken the mutex while the slot was read.
        if (walletBusy) throw new QlyphsError('BUSY', 'Another operation is pending');
        await createJob('vault', c, r.id, r.params.message);
        break;
      }
      case 'mintSession':
        send(c, r.id, { result: mintProjection(c) });
        break;
      case 'stopMintSession': {
        // Only the creating channel sees its session, so only it can stop it; idempotent.
        const run =
          mintProjection(c) !== null && c.mint?.controller.record.id === r.params.session
            ? c.mint
            : undefined;
        run?.controller.stop('cancelled');
        send(c, r.id, { result: run ? run.controller.snapshot() : null });
        break;
      }
    }
  } catch (error) {
    const candidate = r?.id ?? (input as { id?: unknown } | null)?.id;
    const failure = publicError(error, 'VERIFICATION_FAILED', 'not-submitted', reasonOf(error));
    // Session reads change nothing: their errors carry no write outcome, whatever refused them,
    // including a refusal before or while parsing. So the method comes from the input itself.
    const method = (input as { method?: unknown } | null)?.method;
    const read = method === 'mintSession' || method === 'stopMintSession';
    if (typeof candidate === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(candidate))
      send(c, candidate, { error: read ? { code: failure.code } : failure });
  } finally {
    publishStates();
  }
}
/**
 * The wallet's side panels. A request from a site whose window shows the panel opens there instead
 * of in a new window. The panel takes it only on its home view; then the page that shows the review
 * keeps a channel open, and closing or leaving it cancels the review, as closing a window does.
 */
interface Panel {
  port: Port;
  /** The panel's window, as the panel reports it once it connects. Chrome gives a panel shown in
   * every tab no window of its own, and its messages no document id, so the panel says where it is. */
  window: Promise<number | undefined>;
  /** The request this panel document shows, from its own URL. */
  request: string | null;
  /** The key this page received for that request. */
  key?: string;
  offer?: (accepted: boolean) => void;
}
const panels = new Set<Panel>();
/** Requests a panel took whose review page has not connected yet. */
const panelHandoffs = new Map<string, ReturnType<typeof setTimeout>>();
const PANEL_ANSWER_MS = 1500,
  PANEL_LOAD_MS = 10_000;
/** Offers a request to the side panel of the asking tab's window: the window id once its home view
 * took it, else undefined and the request opens in its own window. */
async function offerPanel(tabId: number, request: string): Promise<number | undefined> {
  if (panels.size === 0) return undefined;
  let windowId: number | undefined;
  try {
    windowId = (await browser.tabs.get(tabId)).windowId;
  } catch {
    return undefined;
  }
  if (windowId === undefined) return undefined;
  // Every panel's window is read at once: a panel that never says where it is delays no other.
  const all = [...panels];
  const windows = await Promise.all(all.map((panel) => panel.window));
  for (const [i, panel] of all.entries()) {
    if (windows[i] !== windowId || !panels.has(panel) || panel.request !== null || panel.offer) continue;
    const accepted = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), PANEL_ANSWER_MS);
      panel.offer = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      try {
        panel.port.postMessage({ action: 'open-request', request });
      } catch {
        resolve(false);
      }
    });
    panel.offer = undefined;
    if (!accepted) continue;
    panelHandoffs.set(
      request,
      setTimeout(() => {
        panelHandoffs.delete(request);
        cancel(request);
      }, PANEL_LOAD_MS),
    );
    return windowId;
  }
  return undefined;
}
/** Gives a panel request's key to the first page that shows it in the panel that took it, once both
 * that page is connected and the request is bound to the panel's window. */
async function handPanelKey(request: string): Promise<void> {
  for (const panel of panels) {
    if (panel.request !== request) continue;
    const windowId = await panel.window;
    const job = jobs.get(request);
    if (!job?.panel || job.panelKey || !panelHandoffs.has(request) || job.windowId === undefined) return;
    if (windowId !== job.windowId) continue;
    clearTimeout(panelHandoffs.get(request));
    panelHandoffs.delete(request);
    job.panelKey = panel.key = crypto.randomUUID();
    panel.port.postMessage({ key: job.panelKey });
    return;
  }
}
function connectPanel(port: Port): void {
  const s = port.sender;
  requireThat(
    s?.id === browser.runtime.id &&
      s.tab === undefined &&
      sameExtensionPage(s.url, root, '/ui.html') &&
      new URL(s.url!).searchParams.get('surface') === 'sidebar',
    'Invalid channel',
  );
  const request = new URL(s!.url!).searchParams.get('request');
  let located: (windowId: number | undefined) => void = () => undefined;
  const panel: Panel = {
    port,
    window: new Promise((resolve) => {
      located = resolve;
      setTimeout(() => resolve(undefined), PANEL_ANSWER_MS);
    }),
    request,
  };
  panels.add(panel);
  if (request !== null) void handPanelKey(request);
  port.onMessage.addListener((message) => {
    const m = message as { accepted?: unknown; window?: unknown };
    if (Number.isSafeInteger(m?.window) && (m.window as number) >= 0) located(m.window as number);
    if (panel.offer && typeof m?.accepted === 'boolean') panel.offer(m.accepted);
  });
  port.onDisconnect.addListener(() => {
    panels.delete(panel);
    panel.offer?.(false);
    if (request !== null && jobs.get(request)?.panel) cancel(request);
    // Closing or leaving the panel page of a session ends its signing, as closing its window does.
    if (panel.key)
      for (const [id, run] of mintWindows)
        if (run.binding.panelKey === panel.key) {
          run.binding.windowGone = true;
          run.controller.stop('window');
          mintWindows.delete(id);
        }
  });
}
browser.runtime.onConnect.addListener((port) => {
  if (port.name === 'qlyphs-panel') {
    try {
      connectPanel(port);
    } catch {
      port.disconnect();
    }
    return;
  }
  try {
    const s = port.sender;
    requireThat(
      port.name === 'qlyphs-v1' && s?.id === browser.runtime.id && s.tab?.id !== undefined,
      'Invalid channel',
    );
    const c: Connection = {
      // Any compiled network's origin may connect; `handlePage` answers only the active network's.
      origin: pageOrigin(s!.url, s!.frameId, ALL_DAPPS),
      tabId: s!.tab!.id!,
      document: s!.documentId ?? crypto.randomUUID(),
      port,
      alive: true,
      ids: new Set(),
      count: 0,
      reset: Date.now() + 60000,
      revision: 0,
      subscribed: false,
    };
    connections.add(c);
    port.onMessage.addListener((message) => {
      void handlePage(c, message);
    });
    port.onDisconnect.addListener(() => {
      c.alive = false;
      stopMintSessions('disconnected', (b) => b.connection === c);
      connections.delete(c);
      invalidate((j) => j.connection === c);
    });
  } catch {
    port.disconnect();
  }
});
function invalidateTab(tabId: number): void {
  passkeyAttempts.invalidate((d) => d.tabId === tabId);
  for (const c of connections)
    if (c.tabId === tabId) {
      c.alive = false;
      // Any URL change counts, in-page navigation included: the page that asked may be gone.
      stopMintSessions('disconnected', (b) => b.connection === c);
      invalidate((j) => j.connection === c);
      try {
        c.port.disconnect();
      } catch {
        /* gone */
      }
      connections.delete(c);
    }
}
browser.tabs.onUpdated.addListener((id, change) => {
  if (change.url || change.status === 'loading') invalidateTab(id);
});
browser.tabs.onRemoved.addListener(invalidateTab);
browser.windows.onRemoved.addListener((id) => {
  invalidate((j) => j.windowId === id);
  // Closing the progress window ends signing; Keys reports it before dropping the site's port.
  for (const [request, run] of mintWindows)
    if (run.binding.windowId === id) {
      run.binding.windowGone = true;
      run.controller.stop('window');
      mintWindows.delete(request);
    }
});
browser.alarms.onAlarm.addListener(() => {
  publishStates();
  // A backstop: each session's loop checks its authority on its own, every second while it waits.
  for (const run of mintControllers.values()) {
    let lost: WalletEndReason | null;
    try {
      lost = mintAuthority(run.binding);
    } catch {
      lost = 'unavailable';
    }
    if (lost) run.controller.stop(lost);
  }
  for (const [request, run] of mintWindows) {
    const ended = run.controller.record.endedAt;
    if (ended !== null && Date.now() - ended > ENDED_RETENTION_MS) mintWindows.delete(request);
  }
  for (const [id, job] of jobs)
    try {
      // Consuming a review is normal while asynchronous verification runs.
      // Expire the actual job deadline; do not mistake consumption for revocation.
      current(job);
      if (job.phase === 'review') requests.get(id);
    } catch {
      cancel(id);
    }
  void loaded
    .then(async () => {
      if (
        state.notifications &&
        state.manifest &&
        (await notificationPermission()) &&
        state.transactions.some(
          (t) => !['finalized', 'expired', 'cancelled-before-broadcast'].includes(t.status),
        )
      ) {
        await network(state.manifest);
        await history();
      }
    })
    .catch(() => undefined);
});
let notificationClickBound = false;
function bindNotifications() {
  if (notificationClickBound || !browser.notifications) return;
  browser.notifications.onClicked.addListener((id) => {
    if (/^qlyphs-tx:0x[0-9a-f]{64}$/.test(id))
      void browser.tabs
        .create({
          url: explorerURL(EXPLORER, id.slice('qlyphs-tx:'.length)),
        })
        .catch(() => undefined);
  });
  notificationClickBound = true;
}
bindNotifications();
browser.permissions?.onAdded?.addListener(() => bindNotifications());
void browser.alarms.create('wallet-expiry', { periodInMinutes: 1 });
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install')
    void browser.tabs.create({
      url: browser.runtime.getURL('ui.html?surface=tab'),
    });
});
async function handleUI(message: unknown, sender: UISender): Promise<unknown> {
  // The explorer gets public history only; it cannot use wallet/signing actions.
  if (sender.id === browser.runtime.id && sameExtensionPage(sender.url, root, '/explorer.html')) {
    requireThat(message && typeof message === 'object', 'Invalid UI request');
    const m = message as Record<string, unknown>;
    exact(m, ['action']);
    requireThat(m.action === 'explorer-status', 'Extension interface required');
    await loaded;
    return {
      manifest: state.manifest ?? null,
      transactions: state.transactions.map(
        ({ hash, label, status, createdAt, owner, genesis, nativeSuccess, verdict, feeKept }) => ({
          hash,
          label,
          status,
          createdAt,
          owner,
          genesis,
          nativeSuccess,
          verdict,
          ...(feeKept ? { feeKept } : {}),
        }),
      ),
    };
  }
  requireThat(
    sender.id === browser.runtime.id && sameExtensionPage(sender.url, root, '/ui.html'),
    'Extension interface required',
  );
  requireThat(
    message && typeof message === 'object' && JSON.stringify(message).length <= 65536,
    'Invalid UI request',
  );
  const m = { ...(message as Record<string, unknown>) };
  await loaded;
  // A view never reads the wallet half-way through a network switch (no pin yet on the new one).
  while (switching && m.action !== 'switch-network') await switching.catch(() => undefined);
  requireThat(!resetting || m.action === 'status', 'Wallet reset in progress. Try again.');
  if (ACCOUNT_SCOPED_ACTIONS.has(String(m.action))) {
    requireThat(!keyBusy, 'Finish the current operation before changing accounts');
    requireThat(
      typeof m.expectedOwner === 'string' && state.vault && m.expectedOwner === account().owner,
      'Account changed. Refresh this wallet.',
    );
    delete m.expectedOwner;
  }
  switch (m.action) {
    case 'status': {
      exact(m, ['action']);
      await displayReady;
      return {
        backgroundVersion: VERSION,
        account: state.vault && state.manifest ? account() : null,
        unlocked: isUnlocked(),
        backed: state.backed,
        manifest: state.manifest ?? null,
        name: state.name ?? 'Account 1',
        accounts: records(state).map((a) => ({
          ...recordIdentity(a),
          walletOwner: a.vault.owner,
          derivationIndex: a.derived?.index ?? 0,
          name: a.name,
          backed: a.backed,
        })),
        display: displayStatus(),
        sites: Object.keys(state.grants),
        transactions: accountTransactions(),
        mintSession: mintStatus(),
        passkey: !!state.vault && !!accessRecord().passkey,
        unlockSetup:
          session.unlocked && unlinkedWallets().length
            ? {
                name: unlinkedWallets()[0]!.name,
                remaining: unlinkedWallets().length,
              }
            : null,
        unlockHint:
          state.vault && !state.access && records(state).filter((a) => !a.derived).length > 1
            ? accessRecord().name
            : null,
        notifications: {
          enabled: !!state.notifications,
          permitted: await notificationPermission(),
          available: !!browser.permissions,
        },
        pqConfigured: pqConfigured(),
        api: API,
        rpc: RPC,
        network: {
          active: PROFILE.network,
          switchable: SWITCHABLE,
        },
        // What Settings → Network shows and edits: the active network's endpoints, and which
        // of them the user set. Editing needs the browser's permission API (the extension).
        endpoints: {
          rpc: RPC,
          api: API,
          explorer: EXPLORER,
          defaults: defaultEndpoints(),
          custom: customEndpoints(),
          editable: CUSTOM_ENDPOINTS && !!browser.permissions && (!state.vault || isUnlocked()),
        },
        extensionOrigin: root.replace(/\/$/, ''),
      };
    }
    case 'display-mode':
      exact(m, ['action', 'mode']);
      return setDisplayMode(m.mode);
    case 'notifications': {
      exact(m, ['action', 'enabled']);
      requireThat(typeof m.enabled === 'boolean', 'Invalid notification preference');
      if (m.enabled)
        requireThat(await notificationPermission(), 'Allow notifications in Chrome first');
      state.notifications = m.enabled;
      bindNotifications();
      if (m.enabled)
        for (const tx of state.transactions)
          if (notificationOutcome(tx)) tx.notified = notificationOutcome(tx);
      await save();
      return true;
    }
    case 'notification-test': {
      exact(m, ['action']);
      requireThat(
        state.notifications && (await notificationPermission()) && browser.notifications,
        'Enable notifications first',
      );
      requireThat(
        (await browser.notifications!.getPermissionLevel()) === 'granted',
        'Notifications are blocked by your browser',
      );
      await browser.notifications!.create('qlyphs-test', {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icon-128.png'),
        title: 'Qlyphs · Notifications enabled',
        message:
          'You’ll be notified when an operation from this wallet is finalized or needs attention.',
      });
      return true;
    }
    case 'passkey-begin': {
      exact(m, ['action', 'mode']);
      requireThat(m.mode === 'enroll' || m.mode === 'unlock', 'Invalid passkey operation');
      requireThat(
        new URL(sender.url!).searchParams.get('surface') === 'tab',
        'Open the wallet in a tab to use a passkey',
      );
      const a = account(),
        auth = accessRecord();
      void isUnlocked();
      if (m.mode === 'enroll')
        requireThat(
          isUnlocked() && state.backed && !auth.passkey,
          'Unlock and back up your wallet before adding a passkey',
        );
      else requireThat(auth.passkey, 'No passkey is linked to this wallet');
      const salt =
        m.mode === 'enroll' ? hex(crypto.getRandomValues(new Uint8Array(32))) : auth.passkey!.salt;
      const document = sender.documentId ?? sender.url!;
      passkeyAttempts.invalidate((d) => d.document === document);
      const p = passkeyAttempts.add(
        { origin: root, tabId: sender.tab?.id ?? -1, document },
        {
          mode: m.mode,
          epoch: session.epoch,
          salt,
          owner: a.owner,
          credentialId: auth.passkey?.credentialId,
        },
      );
      return {
        id: p.id,
        challenge: hex(crypto.getRandomValues(new Uint8Array(32))),
        salt,
        credentialId: p.value.credentialId,
        owner: auth.vault.owner,
      };
    }
    case 'passkey-complete': {
      exact(m, ['action', 'id', 'credentialId', 'prf', 'password']);
      requireThat(
        typeof m.id === 'string' &&
          typeof m.credentialId === 'string' &&
          typeof m.prf === 'string' &&
          typeof m.password === 'string',
        'Invalid passkey response',
      );
      const p = passkeyAttempts.consume(m.id),
        a = p.value;
      requireThat(
        p.document.document === (sender.documentId ?? sender.url!) &&
          p.document.tabId === (sender.tab?.id ?? -1),
        'Passkey request belongs to another page',
      );
      requireThat(
        !keyBusy && state.vault && state.manifest && account().owner === a.owner,
        'Cannot unlock',
      );
      void isUnlocked();
      requireThat(session.epoch === a.epoch, 'Passkey request expired. Try again.');
      keyBusy = true;
      const auth = accessRecord();
      let clear: Uint8Array | undefined, prf: Uint8Array | undefined;
      try {
        prf = fromHex(m.prf, 32);
        if (a.mode === 'enroll') {
          requireThat(
            isUnlocked() && state.backed && !auth.passkey,
            'Unlock and back up your wallet before adding a passkey',
          );
          clear = await decryptVault(auth.vault, m.password, auth.vault.genesis, identity);
          const wrapped = await wrapPasskey(
            clear,
            prf,
            auth.vault,
            root.replace(/\/$/, ''),
            m.credentialId,
            a.salt,
          );
          requireThat(
            isUnlocked() && session.epoch === a.epoch,
            'Passkey request expired. Try again.',
          );
          setAccessPasskey(wrapped);
          try {
            await save();
          } catch (e) {
            setAccessPasskey();
            throw e;
          }
        } else {
          requireThat(
            auth.passkey &&
              a.credentialId === m.credentialId &&
              auth.passkey.credentialId === m.credentialId,
            'Passkey does not match this wallet',
          );
          clear = await unwrapPasskey(
            auth.passkey,
            prf,
            auth.vault,
            root.replace(/\/$/, ''),
            identity,
          );
          if (!unlinkedWallets().length) await verifyInstallation(clear);
          installUnlock(clear, a.epoch, !unlinkedWallets().length);
        }
        return true;
      } finally {
        clear?.fill(0);
        prf?.fill(0);
        keyBusy = false;
      }
    }
    case 'passkey-remove': {
      exact(m, ['action', 'password']);
      requireThat(
        state.vault && state.manifest && isUnlocked() && !keyBusy && typeof m.password === 'string',
        'Unlock required',
      );
      keyBusy = true;
      const epoch = session.epoch;
      let clear: Uint8Array | undefined;
      try {
        clear = await decryptVault(
          accessRecord().vault,
          m.password,
          accessRecord().vault.genesis,
          identity,
        );
        requireThat(isUnlocked() && session.epoch === epoch, 'Passkey request expired. Try again.');
        const previous = accessRecord().passkey;
        setAccessPasskey();
        try {
          await save();
        } catch (e) {
          setAccessPasskey(previous);
          throw e;
        }
        return true;
      } finally {
        clear?.fill(0);
        keyBusy = false;
      }
    }
    case 'network':
      exact(m, ['action']);
      await pinNetwork();
      return network(state.manifest);
    case 'network-diagnostics': {
      exact(m, ['action']);
      // Read-only: validate the connected node/indexer without replacing the wallet's pin.
      const current = (await network()).manifest;
      return {
        saved: state.manifest ?? null,
        current,
        matches: !!state.manifest && sameNetwork(state.manifest, current),
      };
    }
    case 'configure': {
      exact(m, ['action', 'genesis']);
      requireThat(!state.vault && !walletBusy, 'Network is already pinned to this wallet');
      const s = await network();
      requireThat(s.manifest.genesis === m.genesis, 'Network changed; review again');
      state.manifest = s.manifest;
      await save();
      return true;
    }
    case 'account-select': {
      exact(m, ['action', 'owner']);
      requireThat(typeof m.owner === 'string', 'Wallet not found');
      changingAccountAllowed();
      if (state.vault && m.owner === account().owner) return true;
      const target = state.otherAccounts.find((a) => recordIdentity(a).owner === m.owner);
      requireThat(target, 'Wallet not found');
      keyBusy = true;
      const previous = activeRecord(state),
        others = state.otherAccounts.slice();
      const epoch = session.epoch;
      let clear: Uint8Array | undefined;
      try {
        requireThat(isUnlocked(), 'Unlock your wallet before changing accounts');
        clear = await walletClear(target!.vault, epoch);
        await verifyDerived(new TextDecoder().decode(clear), target!);
        requireThat(isUnlocked() && session.epoch === epoch, 'Wallet locked; try again');
        changeAccountContext();
        selectAccount(state, m.owner);
        try {
          await save();
        } catch (error) {
          activate(state, previous);
          state.otherAccounts = others;
          // The switch moved the epoch: the restored account's key is derived again for it.
          rememberVaultKey();
          throw error;
        }
        rememberVaultKey();
        return true;
      } finally {
        clear?.fill(0);
        keyBusy = false;
      }
    }
    case 'account-rename': {
      exact(m, ['action', 'owner', 'name']);
      changingAccountAllowed();
      requireThat(isUnlocked(), 'Unlock your wallet before renaming accounts');
      const name = accountName(m.name),
        target = records(state).find((a) => recordIdentity(a).owner === m.owner);
      requireThat(target, 'Wallet not found');
      keyBusy = true;
      const previous = target!.name;
      try {
        if (m.owner === account().owner) state.name = name;
        else target!.name = name;
        try {
          await save();
        } catch (error) {
          if (m.owner === account().owner) state.name = previous;
          else target!.name = previous;
          throw error;
        }
        return true;
      } finally {
        keyBusy = false;
      }
    }
    case 'account-derive': {
      exact(m, ['action']);
      changingAccountAllowed();
      // Deriving selects the new account: like a switch, it ends a running mint session first.
      if (mintControllers.size) {
        await stopMintSessionsAndWait('account', ACCOUNT_STOP_MS);
        changingAccountAllowed();
        requireThat(!walletBusy, 'Finish the current operation before changing accounts');
      }
      requireThat(
        state.vault && isUnlocked() && state.backed && !walletBusy,
        'Unlock and back up this wallet before adding an account',
      );
      requireThat(
        records(state).length < MAX_ACCOUNTS,
        'This extension can hold up to 20 accounts',
      );
      keyBusy = true;
      const epoch = session.epoch,
        previous = activeRecord(state),
        others = state.otherAccounts.slice(),
        version = state.version;
      let clear: Uint8Array | undefined;
      try {
        clear = await walletClear(state.vault!, epoch);
        const index = nextDerivation(state),
          who = await identity(new TextDecoder().decode(clear), index);
        requireThat(isUnlocked() && session.epoch === epoch, 'Wallet locked; try again');
        changeAccountContext();
        addDerivedAccount(state, who, index);
        state.version = 3;
        try {
          await save();
        } catch (error) {
          activate(state, previous);
          state.otherAccounts = others;
          state.version = version;
          rememberVaultKey();
          throw error;
        }
        rememberVaultKey();
        return { account: account() };
      } finally {
        clear?.fill(0);
        keyBusy = false;
      }
    }
    case 'create':
    case 'import':
    case 'restore':
    case 'account-create':
    case 'account-import':
    case 'account-restore': {
      const additional = String(m.action).startsWith('account-'),
        action = String(m.action).replace('account-', '');
      exact(
        m,
        action === 'create'
          ? ['action', 'password']
          : action === 'import'
            ? ['action', 'password', 'phrase']
            : ['action', 'password', 'backup'],
      );
      changingAccountAllowed();
      // Adding an account selects it: like a switch, it ends a running mint session first.
      if (additional && mintControllers.size) {
        await stopMintSessionsAndWait('account', ACCOUNT_STOP_MS);
        changingAccountAllowed();
      }
      requireThat(
        state.manifest && !walletBusy,
        'Finish the current operation before changing accounts',
      );
      if (additional)
        requireThat(
          state.vault && isUnlocked() && state.backed,
          'Unlock and back up your current wallet before adding another',
        );
      else requireThat(!state.vault, 'Wallet already exists or an operation is pending');
      requireThat(
        records(state).length < MAX_ACCOUNTS,
        'This extension can hold up to 20 accounts',
      );
      requireThat(typeof m.password === 'string', 'Password required');
      keyBusy = true;
      const epoch = session.epoch;
      let clear: Uint8Array | undefined;
      try {
        await network(state.manifest);
        const backup =
          action === 'restore' ? parseWalletBackup(m.backup, state.manifest!.genesis) : undefined;
        const phrase =
          action === 'create'
            ? generateMnemonic()
            : action === 'import'
              ? requireMnemonic(String(m.phrase))
              : new TextDecoder().decode(
                  (clear = await decryptVault(
                    backup!.vault,
                    m.password,
                    backup!.vault.genesis,
                    identity,
                  )),
                );
        if (backup) {
          requireThat(
            records(state).length + backup.accounts.length <= MAX_ACCOUNTS,
            'This extension can hold up to 20 accounts',
          );
          await verifyBackupAccounts(backup, phrase, identity);
          requireThat(
            !backup.accounts.some((a) =>
              records(state).some((r) => recordIdentity(r).owner === a.owner),
            ),
            'This wallet is already added. Select it from your accounts.',
          );
        }
        const vault = await encryptVault(phrase, m.password, state.manifest!.genesis, identity);
        requireThat(epoch === session.epoch, 'Wallet setup cancelled');
        requireThat(
          !records(state).some((a) => a.vault.owner === vault.owner),
          'This wallet is already added. Select it from your accounts.',
        );
        const previous = {
          vault: state.vault,
          derived: state.derived,
          name: state.name,
          accountIndex: state.accountIndex,
          backed: state.backed,
          grants: state.grants,
          passkey: state.passkey,
          otherAccounts: state.otherAccounts.slice(),
          version: state.version,
          access: state.access,
        };
        clear ??= new TextEncoder().encode(phrase);
        const access = additional
          ? await addWalletLink(vault, clear, epoch)
          : { owner: vault.owner, wallets: {} };
        if (additional) changeAccountContext();
        else lock();
        const nextEpoch = session.epoch;
        state.access = access;
        addAccount(state, vault, action !== 'create');
        if (backup) {
          state.name = backup.accounts[0]!.name;
          for (const a of backup.accounts.slice(1)) {
            addDerivedAccount(state, a, a.index);
            state.name = a.name;
          }
          selectAccount(state, backup.accounts[backup.selected]!.owner);
          if (backup.accounts.length > 1) state.version = 3;
        }
        try {
          await save();
        } catch (error) {
          Object.assign(state, previous);
          throw error;
        }
        if (!additional) installUnlock(clear, nextEpoch, true);
        else rememberVaultKey();
        return {
          account: account(),
          ...(action === 'create' ? { phrase } : {}),
        };
      } finally {
        clear?.fill(0);
        keyBusy = false;
      }
    }
    case 'unlock': {
      exact(m, ['action', 'password']);
      requireThat(
        state.vault && state.manifest && !keyBusy && typeof m.password === 'string',
        'Cannot unlock',
      );
      void session.unlocked;
      keyBusy = true;
      const epoch = session.epoch;
      let clear: Uint8Array | undefined;
      try {
        const missing = unlinkedWallets();
        if (session.unlocked && missing.length) {
          // One-time migration: prove each old password before granting common access.
          const target = missing[0]!;
          clear = await decryptVault(target.vault, m.password, target.vault.genesis, identity);
          const access = await addWalletLink(target.vault, clear, epoch),
            previous = state.access;
          state.access = access;
          try {
            await save();
          } catch (error) {
            state.access = previous;
            throw error;
          }
          stillUnlocked(epoch);
          if (!unlinkedWallets().length) {
            const rootBytes = new TextEncoder().encode(session.phrase(epoch));
            try {
              await verifyInstallation(rootBytes);
              stillUnlocked(epoch);
              accessReady = true;
              rememberVaultKey();
            } catch (error) {
              lock();
              throw error;
            } finally {
              rootBytes.fill(0);
            }
          }
          return true;
        }
        const auth = accessRecord();
        clear = await decryptVault(auth.vault, m.password, auth.vault.genesis, identity);
        // Wallets that already use the installation password migrate together.
        const previous = state.access;
        const access: WalletAccess = {
          owner: auth.vault.owner,
          wallets: { ...previous?.wallets },
        };
        for (const target of missing) {
          let words: Uint8Array | undefined;
          try {
            words = await decryptVault(target.vault, m.password, target.vault.genesis, identity);
            access.wallets[target.vault.owner] = await linkWallet(
              clear,
              words,
              auth.vault,
              target.vault,
              root.replace(/\/$/, ''),
            );
          } catch (error) {
            if (!(error instanceof Error && error.message === VAULT_PASSWORD_ERROR)) throw error;
          } finally {
            words?.fill(0);
          }
        }
        requireThat(session.epoch === epoch, 'Unlock cancelled');
        const oldVault = auth.vault;
        const upgraded =
          oldVault.version === 1
            ? await encryptVault(
                new TextDecoder().decode(clear),
                m.password,
                state.manifest.genesis,
                identity,
              )
            : oldVault;
        const replaceRoot = (vault: Vault) => {
          if (state.vault?.owner === vault.owner) state.vault = vault;
          for (const a of state.otherAccounts) if (a.vault.owner === vault.owner) a.vault = vault;
        };
        requireThat(session.epoch === epoch, 'Unlock cancelled');
        state.access = access;
        replaceRoot(upgraded);
        try {
          if (!unlinkedWallets().length) await verifyInstallation(clear);
          await save();
        } catch (error) {
          state.access = previous;
          replaceRoot(oldVault);
          throw error;
        }
        installUnlock(clear, epoch, !unlinkedWallets().length);
        return true;
      } finally {
        clear?.fill(0);
        keyBusy = false;
      }
    }
    case 'lock':
      exact(m, ['action']);
      lock();
      return true;
    case 'switch-network': {
      // Switchable builds: the user picks the network here, and only here (a page cannot reach
      // this handler). The wallet, its accounts and its unlocked session stay as they are; only
      // where it reads and submits changes. Everything bound to the old network ends: pending
      // requests, site connections and mint sessions. Signing binds the active genesis, so
      // nothing signed for one network can reach the other.
      exact(m, ['action', 'network']);
      requireThat(SWITCHABLE, 'This wallet has a single network');
      requireThat(m.network === 'development' || m.network === 'mainnet', 'Unknown network');
      if (m.network !== NETWORK) {
        // Sessions are bound to the network they started on: they end before it changes.
        stopMintSessions('network');
        abortMintSettling();
      }
      requireThat(!walletBusy && !keyBusy, 'Finish the current operation before switching network');
      if (m.network === NETWORK) return true;
      requireThat(!switching, 'Finish the current operation before switching network');
      const from = NETWORK!;
      invalidate(() => true);
      const move = (async () => {
        await writes;
        await switchNetwork(m.network as 'development' | 'mainnet');
        usePolicy(PROFILE.network);
        placeManifests(state);
        // The first visit pins the network, which needs it to answer; otherwise stay where we were.
        try {
          await pinNetwork();
        } catch (error) {
          await switchNetwork(from);
          usePolicy(PROFILE.network);
          placeManifests(state);
          throw error;
        }
        historyPending = undefined;
        mintWindows.clear();
        await save();
      })();
      switching = move;
      try {
        await move;
      } finally {
        switching = null;
      }
      // Pages reconnect on the new network, where each origin is checked against its list again.
      for (const c of [...connections]) {
        c.alive = false;
        invalidate((j) => j.connection === c);
        try {
          c.port.disconnect();
        } catch {
          /* gone */
        }
        connections.delete(c);
      }
      return true;
    }
    case 'set-endpoints': {
      // Settings → Network → Edit, the extension's own pages only (this handler). Mainnet takes a
      // node, proven against the compiled pins before it is kept; a test network also takes an
      // indexer and an explorer. A different test node or indexer may be another chain with the
      // same genesis: its pin and history start again, so nothing from one shows on the other.
      exact(m, ['action', 'network', 'endpoints']);
      // Where the wallet reads and submits is the wallet's to change, not whoever has the browser.
      requireThat(!state.vault || isUnlocked(), 'Unlock wallet first');
      const name = m.network;
      requireThat(name === 'mainnet' || name === 'development', 'Unknown network');
      requireThat(SWITCHABLE || name === PROFILE.network, 'Unknown network');
      requireThat(CUSTOM_ENDPOINTS && browser.permissions, 'This wallet cannot change its endpoints');
      const next = m.endpoints === null ? null : checkEndpoints(name, m.endpoints, LOCAL_NETWORK);
      requireThat(!walletBusy && !keyBusy && !switching, 'Finish the current operation first');
      const hosts = next ? hostPatterns(next) : [];
      requireThat(
        !hosts.length || (await browser.permissions!.contains({ origins: hosts })),
        'Allow Qlyphs to reach this address first',
      );
      const before = customEndpoints(name);
      const newChain =
        name === 'development' && ((next?.api ?? '') !== (before.api ?? '') || (next?.rpc ?? '') !== (before.rpc ?? ''));
      const active = PROFILE.network === name;
      if (active) {
        // Prove the endpoints answer for this network before keeping them. The probe reads them
        // directly: until they are kept, everything else still goes to the endpoints in use.
        await network(newChain ? undefined : state.manifest, probeEndpoints(name, next));
        requireThat(!walletBusy && !keyBusy && !switching, 'Finish the current operation first');
        stopMintSessions('network');
        abortMintSettling();
        invalidate(() => true);
      }
      await writes;
      await setEndpoints(name, next);
      if (newChain) {
        const pin = active ? state.manifest : state.parked?.network === name ? state.parked : undefined;
        if (pin) state.transactions = state.transactions.filter((t) => t.genesis !== pin.genesis);
        if (active) delete state.manifest;
        else if (state.parked?.network === name) delete state.parked;
      }
      // Only the active network's history and sessions are bound to the endpoints that changed.
      if (active) {
        historyPending = undefined;
        mintWindows.clear();
      }
      await save();
      if (active) {
        // The new chain pins as a first visit does (pinNetwork covers switchable builds).
        if (SWITCHABLE) await pinNetwork();
        else if (state.vault && !state.manifest) {
          state.manifest = (await network()).manifest;
          await save();
        }
        for (const c of [...connections]) {
          c.alive = false;
          invalidate((j) => j.connection === c);
          try {
            c.port.disconnect();
          } catch {
            /* gone */
          }
          connections.delete(c);
        }
      }
      return true;
    }
    case 'ack':
      exact(m, ['action']);
      requireThat(state.vault && isUnlocked(), 'Unlock wallet first');
      state.backed = true;
      // Started before the save: a site asking meanwhile waits for this key, not for a refusal.
      rememberVaultKey();
      await save();
      return true;
    case 'locked-backup':
      exact(m, ['action']);
      requireThat(state.vault, 'Wallet not found');
      return exportWallet(state);
    case 'wallet-reset': {
      exact(m, ['action', 'confirmation']);
      changingAccountAllowed();
      requireThat(
        !new URL(sender.url!).searchParams.has('request') &&
          state.vault &&
          !isUnlocked() &&
          records(state).length === 1 &&
          !walletBusy &&
          m.confirmation === 'START_NEW_WALLET',
        // The backup the reset asks for covers one wallet; with more, each is removed on its own.
        'Reset requires one locked wallet and explicit confirmation',
      );
      resetting = true;
      keyBusy = true;
      try {
        // A reset needs a locked, idle wallet, so every session has already ended; this stays as
        // defence in depth and ends the settle tasks, which would read for a wallet gone.
        stopMintSessions('reset');
        abortMintSettling();
        mintWindows.clear();
        lock();
        await writes;
        const archive = structuredClone(state);
        const fresh: Stored = {
          version: 2,
          manifest: state.manifest,
          ...(state.parked ? { parked: state.parked } : {}),
          backed: false,
          grants: {},
          transactions: [],
          otherAccounts: [],
          notifications: state.notifications,
        };
        // Preserve the encrypted wallet and its metadata in the same storage
        // operation as the reset. A failed write leaves the active wallet intact.
        await browser.storage.local.set({
          ['wallet-archive-' + crypto.randomUUID()]: archive,
          [WALLET_KEY]: fresh,
        });
        state = fresh;
        return true;
      } finally {
        resetting = false;
        keyBusy = false;
      }
    }
    case 'backup':
      exact(m, ['action']);
      requireThat(state.vault && isUnlocked(), 'Unlock wallet first');
      return exportWallet(state);
    case 'recovery': {
      exact(m, ['action', 'password']);
      requireThat(
        state.vault && state.manifest && typeof m.password === 'string',
        'Unlock required',
      );
      const owner = account().owner,
        epoch = session.epoch;
      const clear = await decryptVault(
        accessRecord().vault,
        m.password,
        accessRecord().vault.genesis,
        identity,
      );
      let words: Uint8Array | undefined;
      try {
        words = await walletClear(state.vault, epoch, clear);
        requireThat(
          account().owner === owner && session.epoch === epoch,
          'Account changed. Refresh this wallet.',
        );
        return new TextDecoder().decode(words);
      } finally {
        clear.fill(0);
        words?.fill(0);
      }
    }
    case 'revoke':
      exact(m, ['action', 'origin']);
      requireThat(typeof m.origin === 'string', 'Invalid site');
      await revokeOrigin(m.origin);
      return true;
    case 'balances': {
      exact(m, ['action']);
      const a = account();
      const chain = await network(state.manifest);
      const [balance, view] = await Promise.all([
        api<Record<string, string>>('/api/balance?owner=' + a.owner),
        api<View>('/api/state?owner=' + a.owner),
      ]);
      // Quarks (1-of-1 inscription assets) are listed as 'Quark #n': learn their numbers.
      const held = view.assets.filter(
        (x) => x.definition.policy === 'inscription' && BigInt(x.available) > 0n,
      );
      const numbers = held.length
        ? await qlyphSummaries(
            a.owner,
            held.map((x) => x.id),
            (path) => api<unknown>(path),
            // Numbers are display only: balances still load if the list cannot be read.
          ).catch(() => new Map<string, PublicInscriptionSummary>())
        : new Map<string, PublicInscriptionSummary>();
      // And their content: the Quark tiles draw it, and a collection's mint or document is told
      // apart by it.
      await readQlyphContents([...numbers.keys()]);
      const assets = view.assets.map((x) => {
        if (!numbers.has(x.id)) return x;
        const read = qlyphContents.get(API + ' ' + x.id);
        const s = numbers.get(x.id)!;
        // The height and creator let Activity show which Quark a past creation made.
        return { ...x, qlyph: { number: s.number, height: s.height, creator: s.creator, ...read } };
      });
      await history();
      requireThat(
        state.vault && account().owner === a.owner,
        'Account changed. Refresh this wallet.',
      );
      return {
        owner: a.owner,
        balance,
        assets,
        more: view.more,
        transactions: accountTransactions(a.owner),
        // Display only: lets the UI count down to finality.
        chain: { head: chain.head, finalized: chain.finalized, at: Date.now() },
      };
    }
    case 'token-logo': {
      exact(m, ['action', 'asset']);
      requireThat(typeof m.asset === 'string' && ASSET_ID.test(m.asset), 'Invalid asset');
      // The cache is per app origin: a switchable build never shows one network's logo on the other.
      return await logos(PLATFORM)(m.asset);
    }
    case 'token-profile': {
      exact(m, ['action', 'asset']);
      requireThat(typeof m.asset === 'string' && ASSET_ID.test(m.asset), 'Invalid asset');
      return await profiles(PLATFORM)(m.asset);
    }
    case 'discover': {
      exact(m, ['action']);
      return await discover();
    }
    case 'qtc-price': {
      exact(m, ['action']);
      return await priceRead<QtcPrice>('price', 60_000, () => readQtcPrice());
    }
    case 'qtc-chart': {
      exact(m, ['action', 'range']);
      requireThat(USD_RANGES.some(([r]) => r === m.range), 'Invalid range');
      const range = m.range as UsdRange;
      return await priceRead<[number, number][]>('chart ' + range, 5 * 60_000, () => readQtcChart(range));
    }
    case 'clear-history': {
      exact(m, ['action']);
      requireThat(state.vault && isUnlocked(), 'Unlock wallet first');
      requireThat(
        !keyBusy && ![...jobs.values()].some((job) => job.phase === 'signing'),
        'Finish the current operation first',
      );
      const a = account();
      // Unresolved entries gate the next operation, and mint sessions keep theirs: both stay.
      const sessions = state.mintSessions ?? [];
      const held = new Set(sessions.flatMap((r) => r.attempts.map((x) => x.hash)));
      const previous = state.transactions;
      state.transactions = previous.filter(
        (t) =>
          t.owner !== a.owner ||
          t.genesis !== a.genesis ||
          !FINAL_STATUSES.includes(t.status) ||
          held.has(t.hash) ||
          (t.session !== undefined && sessions.some((r) => r.id === t.session)),
      );
      const removed = previous.length - state.transactions.length;
      if (removed)
        try {
          await save();
        } catch (error) {
          state.transactions = previous;
          throw error;
        }
      return { removed };
    }
    case 'token-market': {
      exact(m, ['action', 'asset']);
      requireThat(typeof m.asset === 'string' && ASSET_ID.test(m.asset), 'Invalid asset');
      return await tokenTrades(m.asset);
    }
    case 'collections': {
      // The page passes the Quarks the indexer listed for this account (its balances view): the app
      // is asked about those only, and can name or draw them, never add one.
      exact(m, ['action', 'quarks']);
      requireThat(
        Array.isArray(m.quarks) &&
          m.quarks.length <= 1000 &&
          m.quarks.every((q: unknown) => typeof q === 'string' && ASSET_ID.test(q)),
        'Invalid Quarks',
      );
      return await holdings(account().owner, m.quarks as string[]);
    }
    case 'discover-collections': {
      exact(m, ['action']);
      return await discoverCollections();
    }
    case 'tx-detail': {
      // Where one of this account's transactions landed: its block, as the indexer locates it and
      // the node names it. Display only; the transaction's status still comes from the history.
      exact(m, ['action', 'hash']);
      requireThat(typeof m.hash === 'string' && /^0x[0-9a-f]{64}$/.test(m.hash), 'Invalid transaction');
      requireThat(accountTransactions().some((tx) => tx.hash === m.hash), 'Unknown transaction');
      const found = await api<{ hash?: string; status?: string; height?: number; index?: number }>(
        '/api/transactions/' + m.hash,
      );
      if (found.hash !== m.hash || !Number.isSafeInteger(found.height) || found.height! < 0) return null;
      const blockHash = await rpc<string>('chain_getBlockHash', [found.height]);
      requireThat(typeof blockHash === 'string' && /^0x[0-9a-f]{64}$/.test(blockHash), 'Invalid block');
      return {
        height: found.height,
        index: Number.isSafeInteger(found.index) ? found.index : null,
        blockHash,
      };
    }
    case 'points': {
      exact(m, ['action']);
      const owner = account().owner;
      return pointsView(await api<unknown>('/api/points?account=' + owner));
    }
    case 'request-state': {
      // Lets the wallet stop waiting when a review it opened is rejected or expires.
      exact(m, ['action', 'id']);
      requireThat(typeof m.id === 'string', 'Invalid request');
      const j = jobs.get(m.id);
      return { state: !j || j.cancelled ? 'closed' : j.phase === 'review' ? 'review' : 'signing' };
    }
    case 'transact':
      exact(m, ['action', 'command']);
      parseCommand(m.command);
      return {
        request: await createJob('transaction', undefined, undefined, m.command),
      };
    case 'review': {
      exact(m, ['action', 'id']);
      requireThat(typeof m.id === 'string', 'Invalid request');
      const j = await reviewSender(sender, m.id);
      if (j.kind === 'signin')
        return {
          id: m.id,
          kind: j.kind,
          origin: j.connection!.origin,
          account: account(),
          expires: requests.get(m.id).expires,
          review: null,
          signIn: {
            actions: j.signIn!.fields.actions,
            expiresAt: j.signIn!.fields.expiresAt,
          },
          digest: j.signIn!.digest,
          unlocked: isUnlocked(),
        };
      if (j.kind === 'vault')
        return {
          id: m.id,
          kind: j.kind,
          origin: j.connection!.origin,
          account: account(),
          expires: requests.get(m.id).expires,
          review: null,
          solanaVault: j.solanaVault!.review,
          digest: j.solanaVault!.digest,
          unlocked: isUnlocked(),
        };
      if (j.kind === 'session')
        return {
          id: m.id,
          kind: j.kind,
          origin: j.connection?.origin ?? 'Qlyphs Wallet',
          account: account(),
          expires: requests.get(m.id).expires,
          review: null,
          session: j.mintReview,
          digest: j.mintReview!.digest,
          unlocked: isUnlocked(),
          // Shown so that the window can tell when signing would stop; never sent to a site.
          unlockDeadline: session.deadline,
        };
      return {
        id: m.id,
        kind: j.kind,
        origin: j.connection?.origin ?? 'Qlyphs Wallet',
        account: account(),
        expires: requests.get(m.id).expires,
        review: j.review ?? null,
        digest: j.review?.digest ?? 'connect',
        unlocked: isUnlocked(),
      };
    }
    case 'approve':
      // A mint session's approval names the page that will follow it: its window lease.
      exact(
        m,
        Object.hasOwn(m, 'page') ? ['action', 'id', 'digest', 'page'] : ['action', 'id', 'digest'],
      );
      requireThat(typeof m.id === 'string' && typeof m.digest === 'string', 'Invalid approval');
      return approve(m.id, m.digest, sender, m.page);
    case 'review-tip':
      exact(m, ['action', 'id', 'tip']);
      requireThat(typeof m.id === 'string' && typeof m.tip === 'string', 'Invalid request');
      return retip(m.id, m.tip, sender);
    case 'session-state': {
      // Answers from memory only: a slow node can never starve the window's lease.
      exact(m, ['action', 'request', 'page']);
      abandonStart(sender, m.request, m.page, false);
      requireThat(!startAbandoned(sender, m.request, m.page), RELOADED_BEFORE_START);
      const run = mintWindow(sender, m.request, m.page);
      // Another page or document in the approved window is a reload: signing stops, and the new
      // page may still follow the session.
      if (!approvedPage(run.binding, sender, m.page)) run.controller.stop('window');
      else run.binding.lease = Date.now() + LEASE_MS;
      run.controller.nudge();
      return run.controller.view();
    }
    case 'session-stop': {
      // Any wallet page may stop a session: stopping only reduces authority.
      exact(m, ['action', 'session']);
      const run = typeof m.session === 'string' ? mintRunById(m.session) : undefined;
      requireThat(run, NO_SESSION);
      run!.controller.stop('stopped');
      return run!.controller.view();
    }
    case 'session-leave': {
      // The approval or progress window is closing or reloading; best effort, the lease stays
      // authoritative.
      exact(m, ['action', 'request', 'page']);
      abandonStart(sender, m.request, m.page, true);
      try {
        const run = mintWindow(sender, m.request, m.page);
        if (approvedPage(run.binding, sender, m.page)) run.controller.stop('window');
      } catch {
        /* not this window's session: nothing to stop */
      }
      return true;
    }
    case 'reject':
      exact(m, ['action', 'id']);
      requireThat(typeof m.id === 'string', 'Invalid request');
      await reviewSender(sender, m.id);
      cancel(m.id, 'USER_REJECTED');
      return true;
    default:
      throw Error('Unsupported UI operation');
  }
}
browser.runtime.onMessage.addListener((message, sender, respond) => {
  // A side panel's request key travels beside the message, never inside what handleUI checks.
  let from: UISender = sender;
  if (message && typeof message === 'object' && 'panelKey' in message) {
    const { panelKey, ...rest } = message as { panelKey: unknown };
    message = rest;
    from = { ...sender, panelKey: typeof panelKey === 'string' ? panelKey : undefined };
  }
  // Chrome runtime messages use JSON, unlike Firefox's structured clone. Keep
  // BigInt amounts exact as decimal strings on the UI wire; signing retains the
  // original typed review in this worker.
  void handleUI(message, from)
    .then((result) => {
      publishStates();
      respond(JSON.parse(json({ result })));
    })
    .catch((error) => {
      publishStates();
      respond({ error: uiError(error) });
    });
  // Callback + true is supported by both browsers; no dependence on gradual
  // Chrome rollout of Promise-returning onMessage listeners.
  return true;
});

/** Quark contents by indexer and id. Content never changes once inscribed, so each is read once;
 * display only (reviews read it again). */
const qlyphContents = new Map<string, { contentType: string; size: number; content: string }>();
async function readQlyphContents(ids: readonly string[]): Promise<void> {
  const base = API;
  const missing = ids.filter((id) => !qlyphContents.has(base + ' ' + id)).slice(0, 60);
  for (let at = 0; at < missing.length; at += 6)
    await Promise.all(
      missing.slice(at, at + 6).map(async (id) => {
        try {
          const q = parseInscription(await api<unknown>('/api/inscription?id=' + encodeURIComponent(id)), id);
          if (qlyphContents.size >= 2000) qlyphContents.delete(qlyphContents.keys().next().value!);
          qlyphContents.set(base + ' ' + id, { contentType: q.contentType, size: q.size, content: q.content });
        } catch {
          // Shown by its number until a later refresh reads it.
        }
      }),
    );
}
/** Logo readers by app origin (display only, see platform.ts). */
const logoReaders = new Map<string, (asset: string) => Promise<string | null>>();
function logos(base: string) {
  let reader = logoReaders.get(base);
  if (!reader) logoReaders.set(base, (reader = logoCache((asset) => readTokenLogo(base, asset))));
  return reader;
}
/** Profile readers by app origin, like logos. */
const profileReaders = new Map<string, (asset: string) => Promise<TokenProfile | null>>();
function profiles(base: string) {
  let reader = profileReaders.get(base);
  if (!reader) profileReaders.set(base, (reader = logoCache((asset) => readTokenProfile(base, asset))));
  return reader;
}
/** The account's collection items, from the app, for 30 s per account and set of Quarks. */
let held: { key: string; at: number; value: Promise<Holdings> } | undefined;
function holdings(owner: string, quarks: readonly string[]) {
  const base = PLATFORM;
  const key = [base, owner, ...[...quarks].sort()].join(' ');
  if (held && held.key === key && Date.now() - held.at < 30_000) return held.value;
  const value = readHoldings(base, owner, new Set(quarks));
  held = { key, at: Date.now(), value };
  value.catch(() => {
    if (held?.value === value) held = undefined;
  });
  return value;
}
/** The collections Explore lists, from the app, for 30 s. */
let collectionList: { base: string; at: number; value: Promise<{ open: boolean; collections: CollectionSummary[] }> } | undefined;
function discoverCollections() {
  const base = PLATFORM;
  if (collectionList && collectionList.base === base && Date.now() - collectionList.at < 30_000)
    return collectionList.value;
  const value = readCollections(base);
  collectionList = { base, at: Date.now(), value };
  value.catch(() => {
    if (collectionList?.value === value) collectionList = undefined;
  });
  return value;
}
/** The Explore catalogue: the indexer's first page of tokens with their statistics, for 30 s. */
/** A token's recent trades for its price chart, kept 30 s per indexer and token. */
const trades = new Map<string, { at: number; value: Promise<Trade[]> }>();
function tokenTrades(asset: string): Promise<Trade[]> {
  const key = API + ' ' + asset;
  const known = trades.get(key);
  if (known && Date.now() - known.at < 30_000) return known.value;
  const value = Promise.all([
    api<unknown>('/api/sales?asset=' + asset),
    api<unknown>('/api/asset-activity?asset=' + asset).catch(() => null),
  ]).then(([sales, activity]) => readTrades(asset, sales, activity));
  trades.delete(key);
  trades.set(key, { at: Date.now(), value });
  while (trades.size > 50) trades.delete(trades.keys().next().value!);
  value.catch(() => {
    if (trades.get(key)?.value === value) trades.delete(key);
  });
  return value;
}
let catalogue: { api: string; at: number; value: Promise<{ tokens: CatalogToken[]; more: boolean }> } | undefined;
function discover() {
  const base = PLATFORM;
  if (catalogue && catalogue.api === base && Date.now() - catalogue.at < 30_000) return catalogue.value;
  const value = Promise.all([
    api<View & { assets: Parameters<typeof catalog>[0] }>('/api/state'),
    api<{ stats: Parameters<typeof catalog>[1] }>('/api/asset-stats').catch(() => ({ stats: [] })),
  ]).then(([view, stats]) => ({ tokens: catalog(view.assets, stats.stats), more: !!view.more }));
  catalogue = { api: base, at: Date.now(), value };
  value.catch(() => {
    if (catalogue?.value === value) catalogue = undefined;
  });
  return value;
}
