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
import type { Port, Sender } from './browser.ts';
import {
  ALL_DAPPS,
  API,
  DAPPS,
  loadNetwork,
  NETWORK,
  PROFILE,
  profileOf,
  RPC,
  SWITCHABLE,
  switchNetwork,
  VERSION,
  walletKey,
} from './config.ts';
import { api, network, prepare, recheck } from './network.ts';
import { qlyphNumbers } from './qlyphs.ts';
import { submitOnce } from './submission.ts';
import type { Manifest, Review, View } from './network.ts';
import { SecretSession, encryptVault, decryptVault, validateVault } from './vault.ts';
import type { Vault } from './vault.ts';
import { identity, wasm } from './signer.ts';
import { parseRequest, exact, pageOrigin, sameExtensionPage, Requests } from './requests.ts';
import type { BoundDocument, Request } from './requests.ts';
import { generateMnemonic, requireMnemonic } from '../../../packages/chain/src/browser/mnemonic.ts';
import { fromHex, hex, requireThat, assetId } from '../../../packages/native/src/codec.ts';
import {
  extrinsicHash,
  parseSignedExtrinsic,
} from '../../../packages/chain/src/codec/extrinsic.ts';
import { parseCommand, json } from '../../native/src/commands.ts';
import { authorizePurchase, pqConfigured } from '../../native/web/pq-guard.ts';
import { capabilities, QlyphsError, publicError } from '../../../packages/provider/src/index.ts';
import type { ProviderState, PublicErrorCode } from '../../../packages/provider/src/index.ts';

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
  /** Display-only copy of the approved transfer; never used for signing or status. */
  height?: number;
  amount?: string;
  to?: string;
  symbol?: string;
  decimals?: number;
}
interface Stored extends AccountBook {
  access?: WalletAccess;
  version: 2 | 3;
  notifications?: boolean;
  manifest?: Manifest;
  transactions: Transaction[];
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
}
interface Job {
  kind: 'connect' | 'transaction';
  owner: string;
  genesis: string;
  epoch: number;
  connection?: Connection;
  requestId?: string;
  connectionRevision?: number;
  review?: Review;
  windowId?: number;
  windowReady?: Promise<void>;
  expires?: number;
  cancelled: boolean;
  phase: 'review' | 'signing';
  reply: (value: unknown) => void;
}
interface PasskeyAttempt {
  mode: 'enroll' | 'unlock';
  epoch: number;
  salt: string;
  owner: string;
  credentialId?: string;
}
const passkeyAttempts = new Requests<PasskeyAttempt>();
const session = new SecretSession();
let accessReady = false;
const requests = new Requests<Job>(),
  jobs = new Map<string, Job>(),
  connections = new Set<Connection>();
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
const emptyState = (): Stored => ({
  version: 2,
  backed: false,
  grants: {},
  transactions: [],
  otherAccounts: [],
});
/** Read the active network's wallet state (a switchable build keeps one per network). */
async function readState(): Promise<void> {
  const stored = (await browser.storage.local.get(walletKey()))[walletKey()];
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
    if (s.vault) {
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
    validateAccounts(s, s.manifest?.genesis, root.replace(/\/$/, ''));
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
    state = s;
    if (legacy) await browser.storage.local.set({ [walletKey()]: structuredClone(state) });
    for (const tx of state.transactions)
      if (tx.status === 'signed-not-submitted') tx.status = 'cancelled-before-broadcast';
  }
}
/** Mainnet (switchable build): the development wallet, which the user can carry over with all its
 * accounts. Same recovery phrases, so the same addresses; each wallet is re-encrypted for mainnet
 * with the password that unlocks the development one. A mainnet wallet may already exist only if
 * all its accounts come from development (an earlier, partial carry): nothing of its own is lost. */
async function developmentWallet(): Promise<Stored | null> {
  if (!SWITCHABLE || NETWORK !== 'mainnet') return null;
  const dev = (await browser.storage.local.get('wallet')).wallet as Stored | undefined;
  if (!dev?.vault) return null;
  try {
    const book = { ...dev, otherAccounts: dev.otherAccounts ?? [] };
    const devRecords = records(book);
    for (const a of devRecords) validateVault(a.vault, a.vault.genesis, profileOf('development'));
    if (state.vault) {
      const owners = new Set(devRecords.map((a) => recordIdentity(a).owner)),
        mine = records(state);
      if (mine.length >= devRecords.length) return null;
      if (!mine.every((a) => owners.has(recordIdentity(a).owner))) return null;
    }
    return book;
  } catch {
    return null;
  }
}
const loaded = (async () => {
  // A switchable build learns its network first: the wallet state is stored per network.
  await loadNetwork();
  await browser.storage.local.setAccessLevel?.({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
  await readState();
})();
function save(): Promise<void> {
  requireThat(!resetting, 'Wallet reset in progress. Try again.');
  const snapshot = structuredClone(state);
  const next = writes.then(() => browser.storage.local.set({ [walletKey()]: snapshot }));
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
    session.phrase(epoch);
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
  session.invalidate();
  passkeyAttempts.invalidate(() => true);
  invalidate(() => true);
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
    };
  if (c.kind === 'inscribe') return { symbol: 'Quark' };
  return {};
}
function accountTransactions(owner = state.vault ? account().owner : undefined): Transaction[] {
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
  const before = session.epoch;
  void isUnlocked();
  if (session.epoch !== before) invalidate(() => true);
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
}
async function revokeOrigin(origin: string): Promise<void> {
  // Revocation must not silently come back when selecting another saved account.
  for (const record of records(state)) delete record.grants[origin];
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
      c.port.postMessage(
        error
          ? {
              id,
              error: {
                code: error.code,
                message: error.message,
                ...(error.outcome ? { outcome: error.outcome } : {}),
              },
            }
          : { id, ...payload },
      );
    } catch {
      c.alive = false;
    }
  c.ids.delete(id);
}
function finish(id: string, value: unknown): void {
  const job = jobs.get(id);
  if (!job) return;
  requests.remove(id);
  jobs.delete(id);
  job.reply(value);
  if (job.kind === 'transaction') walletBusy = false;
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
function lock(): void {
  accessReady = false;
  session.lock();
  passkeyAttempts.invalidate(() => true);
  invalidate(() => true);
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
  for (const tx of state.transactions) {
    if (['finalized', 'expired', 'cancelled-before-broadcast'].includes(tx.status)) continue;
    try {
      const s = await api<{
        status: string;
        height?: number | null;
        nativeSuccess?: boolean | null;
        verdict?: string | null;
      }>('/api/transactions/' + tx.hash);
      if (
        ['pending', 'included', 'finalized', 'expired', 'indexer-unavailable'].includes(s.status)
      ) {
        tx.status = s.status;
        if (Number.isSafeInteger(s.height)) tx.height = s.height!;
        tx.nativeSuccess = s.nativeSuccess;
        tx.verdict = s.verdict;
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
        if (trustedStatus.finalized > tx.validUntil) {
          const latest = await api<{
            status: string;
            nativeSuccess?: boolean | null;
            verdict?: string | null;
          }>('/api/transactions/' + tx.hash);
          if (latest.status === 'finalized') {
            tx.status = 'finalized';
            tx.nativeSuccess = latest.nativeSuccess;
            tx.verdict = latest.verdict;
            changed = true;
          } else if (['pending', 'unknown', 'expired'].includes(latest.status)) {
            tx.status = 'expired';
            tx.nativeSuccess = null;
            tx.verdict = null;
            changed = true;
          }
        }
      }
    } catch {
      tx.status = 'unknown';
      changed = true;
    }
  }
  if (changed) await save();
  await notifyHistory().catch(() => undefined);
  return state.transactions;
}
async function createJob(
  kind: 'connect' | 'transaction',
  connection: Connection | undefined,
  requestId: string | undefined,
  input?: unknown,
): Promise<string> {
  const a = account();
  if (kind === 'transaction') {
    requireThat(!walletBusy, 'Another operation is pending; finish it before trying again');
    requireThat(state.backed, 'Save and acknowledge your recovery backup first');
    if (connection) requireThat(permitted(connection), 'Connect this site first');
    walletBusy = true;
  }
  let inserted: string | undefined;
  try {
    // Trigger real-deadline expiry before binding a new request to the epoch.
    void isUnlocked();
    const job: Job = {
      kind,
      owner: a.owner,
      genesis: a.genesis,
      epoch: session.epoch,
      connection,
      requestId,
      connectionRevision: connection?.revision,
      cancelled: false,
      phase: 'review',
      reply: connection && requestId ? (v) => send(connection, requestId, v) : () => undefined,
    };
    const doc: BoundDocument = connection ?? {
      origin: 'Qlyphs Wallet',
      tabId: -1,
      document: crypto.randomUUID(),
    };
    if (kind === 'transaction') {
      await history();
      requireThat(
        !state.transactions.some(
          (t) =>
            t.owner === a.owner &&
            t.genesis === a.genesis &&
            !['finalized', 'expired', 'cancelled-before-broadcast'].includes(t.status),
        ),
        'Wait for the previous operation to finalize. Unknown submissions are never recreated',
      );
      const command = parseCommand(input);
      if (command.kind === 'buy')
        requireThat(pqConfigured, 'Purchases disabled: no bundled PQ witness policy');
      job.review = await prepare(state.manifest!, a.owner, input);
    } else await network(state.manifest!);
    current(job);
    const p = requests.add(doc, job);
    jobs.set(p.id, job);
    inserted = p.id;
    job.expires = p.expires;
    // A new extension page may message us before windows.create() resolves.
    // Bind the authoritative window ID before serving any review/approval.
    job.windowReady = browser.windows
      .create({
        url: browser.runtime.getURL('ui.html?request=' + p.id),
        type: 'popup',
        width: 480,
        height: 740,
      })
      .then((w) => {
        requireThat(w.id !== undefined, 'Confirmation window could not be opened');
        job.windowId = w.id;
      });
    await job.windowReady;
    return p.id;
  } catch (e) {
    if (inserted) {
      requests.remove(inserted);
      jobs.delete(inserted);
    }
    if (kind === 'transaction') walletBusy = false;
    throw e;
  }
}
async function reviewSender(sender: Sender, id: string): Promise<Job> {
  requireThat(
    sameExtensionPage(sender.url, root, '/ui.html') &&
      new URL(sender.url!).searchParams.get('request') === id,
    'Approval must come from its extension confirmation window',
  );
  const j = requests.get(id).value;
  await j.windowReady;
  requireThat(requests.get(id).value === j, 'Request context changed');
  current(j);
  if (sender.tab?.windowId !== undefined)
    requireThat(j.windowId === sender.tab.windowId, 'Wrong confirmation window');
  return j;
}
async function approve(id: string, digest: string, sender: Sender): Promise<unknown> {
  const job = await reviewSender(sender, id);
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
    session.phrase(job.epoch);
    current(job);
    requireThat(Date.now() < review.intent.expiresAt, 'Review expired during verification');
    // Synchronous signing: no asynchronous boundary between the last authorization
    // check and use of the secret. Unknown sign failures are never logged verbatim.
    let signed: Uint8Array;
    try {
      signed = signer.signCallFromMnemonic(
        phrase,
        fromHex(review.intent.callHex),
        review.intent.context,
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
        parsed.nonce === review.intent.context.nonce,
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
    };
    requireThat(
      state.transactions.length < 200,
      'Archive capacity reached; preserve history before continuing',
    );
    state.transactions.unshift(tx);
    // Persist identity/hash before any broadcast. Never persist the phrase or raw signature.
    await save();
    current(job);
    session.phrase(job.epoch);
    tx.status = 'broadcast-uncertain';
    await save();
    current(job);
    session.phrase(job.epoch);
    const submitted = await submitOnce(hash, () =>
      api('/api/submit', { id: review.intent.id, raw: hex(signed) }),
    );
    tx.status = submitted.status;
    await save();
    const result = {
      hash,
      // History reconciliation can mutate tx while storage is awaiting IO.
      // A submission acknowledgment is immutable, not an inclusion status.
      status: submitted.status,
      ...(review.command.kind === 'deploy' || review.command.kind === 'inscribe'
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
    finish(id, {
      error: publicError(
        null,
        'VERIFICATION_FAILED',
        tx && tx.status !== 'cancelled-before-broadcast' ? 'unknown' : 'not-submitted',
      ),
    });
    throw Error(uiError(error), { cause: error });
  } finally {
    walletBusy = false;
  }
}
async function handlePage(c: Connection, input: unknown): Promise<void> {
  let r: Request | undefined;
  try {
    await loaded;
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
    switch (r.method) {
      case 'capabilities':
        send(c, r.id, { result: capabilities(PROFILE.network) });
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
    }
  } catch (error) {
    const candidate = r?.id ?? (input as { id?: unknown } | null)?.id;
    if (typeof candidate === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(candidate))
      send(c, candidate, { error: publicError(error, 'VERIFICATION_FAILED', 'not-submitted') });
  } finally {
    publishStates();
  }
}
browser.runtime.onConnect.addListener((port) => {
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
});
browser.alarms.onAlarm.addListener(() => {
  publishStates();
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
async function handleUI(message: unknown, sender: Sender): Promise<unknown> {
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
        ({ hash, label, status, createdAt, owner, genesis, nativeSuccess, verdict }) => ({
          hash,
          label,
          status,
          createdAt,
          owner,
          genesis,
          nativeSuccess,
          verdict,
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
        account: state.vault ? account() : null,
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
        pqConfigured,
        api: API,
        rpc: RPC,
        network: {
          active: PROFILE.network,
          switchable: SWITCHABLE,
          carry: (await developmentWallet()) !== null,
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
          clear = await decryptVault(auth.vault, m.password, state.manifest.genesis, identity);
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
          session.install(clear, a.epoch);
          accessReady = !unlinkedWallets().length;
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
          state.manifest.genesis,
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
          throw error;
        }
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
          throw error;
        }
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
                    state.manifest!.genesis,
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
        if (!additional) {
          session.install(clear, nextEpoch);
          accessReady = true;
        }
        return {
          account: account(),
          ...(action === 'create' ? { phrase } : {}),
        };
      } finally {
        clear?.fill(0);
        keyBusy = false;
      }
    }
    case 'carry': {
      // Switchable builds: the development wallet, every account included, becomes the mainnet
      // one. Its password opens the installation wallet; the other wallets open through their
      // installation links (or the same password). A wallet that opens with neither stays behind.
      exact(m, ['action', 'password']);
      changingAccountAllowed();
      requireThat(state.manifest && !walletBusy && !keyBusy, 'Finish the current operation first');
      requireThat(typeof m.password === 'string', 'Password required');
      const dev = await developmentWallet();
      requireThat(dev, 'No development wallet to use here');
      requireThat(!state.vault || isUnlocked(), 'Unlock wallet first');
      keyBusy = true;
      const origin = root.replace(/\/$/, ''),
        devProfile = profileOf('development'),
        phrases = new Map<string, Uint8Array>();
      try {
        await network(state.manifest);
        const devRecords = records(dev!),
          roots = devRecords.filter((a) => !a.derived),
          anchor =
            (dev!.access && roots.find((a) => a.vault.owner === dev!.access!.owner)) || roots[0]!,
          anchorClear = await decryptVault(
            anchor.vault,
            m.password,
            anchor.vault.genesis,
            identity,
            devProfile,
          );
        phrases.set(anchor.vault.owner, anchorClear);
        for (const r of roots) {
          if (phrases.has(r.vault.owner)) continue;
          const linked = dev!.access?.wallets[r.vault.owner];
          try {
            phrases.set(
              r.vault.owner,
              linked
                ? await openLinkedWallet(linked, anchorClear, anchor.vault, r.vault, origin, identity)
                : await decryptVault(r.vault, m.password, r.vault.genesis, identity, devProfile),
            );
          } catch (error) {
            if (!(error instanceof Error && error.message === VAULT_PASSWORD_ERROR)) throw error;
          }
        }
        const vaults = new Map<string, Vault>();
        for (const [owner, clear] of phrases)
          vaults.set(
            owner,
            await encryptVault(
              new TextDecoder().decode(clear),
              m.password,
              state.manifest!.genesis,
              identity,
            ),
          );
        const mainAnchor = vaults.get(anchor.vault.owner)!,
          access: WalletAccess = { owner: mainAnchor.owner, wallets: {} };
        for (const [owner, clear] of phrases)
          if (owner !== mainAnchor.owner)
            access.wallets[owner] = await linkWallet(
              anchorClear,
              clear,
              mainAnchor,
              vaults.get(owner)!,
              origin,
            );
        // Grants, passkeys and history belong to their network: development ones stay there, and
        // an account already on mainnet keeps its site connections and history.
        const kept = new Map(records(state).map((a) => [recordIdentity(a).owner, a.grants]));
        const carried = devRecords
          .filter((a) => vaults.has(a.vault.owner))
          .map((a) => ({
            vault: vaults.get(a.vault.owner)!,
            ...(a.derived ? { derived: a.derived } : {}),
            name: a.name,
            accountIndex: a.accountIndex,
            backed: a.backed,
            grants: kept.get(recordIdentity(a).owner) ?? {},
          }));
        const selectedOwner = recordIdentity(activeRecord(dev!)).owner,
          selected = carried.find((a) => recordIdentity(a).owner === selectedOwner) ?? carried[0]!;
        const before = state;
        lock();
        const epoch = session.epoch;
        state = {
          ...emptyState(),
          manifest: state.manifest,
          transactions: state.transactions,
          ...(state.notifications !== undefined ? { notifications: state.notifications } : {}),
          version: carried.some((a) => a.derived) ? 3 : 2,
          access,
          otherAccounts: carried.filter((a) => a !== selected),
        };
        activate(state, selected);
        try {
          await verifyInstallation(anchorClear);
          await save();
        } catch (error) {
          state = before;
          throw error;
        }
        session.install(anchorClear, epoch);
        accessReady = true;
        return {
          account: account(),
          carried: carried.length,
          skipped: devRecords.length - carried.length,
        };
      } finally {
        for (const clear of phrases.values()) clear.fill(0);
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
          clear = await decryptVault(target.vault, m.password, state.manifest.genesis, identity);
          const access = await addWalletLink(target.vault, clear, epoch),
            previous = state.access;
          state.access = access;
          try {
            await save();
          } catch (error) {
            state.access = previous;
            throw error;
          }
          session.phrase(epoch);
          if (!unlinkedWallets().length) {
            const rootBytes = new TextEncoder().encode(session.phrase(epoch));
            try {
              await verifyInstallation(rootBytes);
              session.phrase(epoch);
              accessReady = true;
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
        clear = await decryptVault(auth.vault, m.password, state.manifest.genesis, identity);
        // Wallets that already use the installation password migrate together.
        const previous = state.access;
        const access: WalletAccess = {
          owner: auth.vault.owner,
          wallets: { ...previous?.wallets },
        };
        for (const target of missing) {
          let words: Uint8Array | undefined;
          try {
            words = await decryptVault(target.vault, m.password, state.manifest.genesis, identity);
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
        session.install(clear, epoch);
        accessReady = !unlinkedWallets().length;
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
      // this handler). The wallet is locked and the extension restarts on the other network, with
      // that network's own wallet state; nothing signed for one network can reach the other.
      exact(m, ['action', 'network']);
      requireThat(SWITCHABLE, 'This wallet has a single network');
      requireThat(m.network === 'development' || m.network === 'mainnet', 'Unknown network');
      requireThat(!walletBusy && !keyBusy, 'Finish the current operation before switching network');
      if (m.network === NETWORK) return true;
      lock();
      await writes;
      await switchNetwork(m.network as 'development' | 'mainnet');
      // The other network's wallet, from its own storage; nothing of this one carries over.
      state = emptyState();
      accessReady = false;
      historyPending = undefined;
      await readState();
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
    case 'ack':
      exact(m, ['action']);
      requireThat(state.vault && isUnlocked(), 'Unlock wallet first');
      state.backed = true;
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
        'Reset requires one locked wallet and explicit confirmation',
      );
      resetting = true;
      keyBusy = true;
      try {
        lock();
        await writes;
        const archive = structuredClone(state);
        const fresh: Stored = {
          version: 2,
          manifest: state.manifest,
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
          [walletKey()]: fresh,
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
        state.manifest.genesis,
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
        ? await qlyphNumbers(
            a.owner,
            held.map((x) => x.id),
            (path) => api<unknown>(path),
            // Numbers are display only: balances still load if the list cannot be read.
          ).catch(() => new Map<string, number>())
        : new Map<string, number>();
      const assets = view.assets.map((x) =>
        numbers.has(x.id) ? { ...x, qlyph: { number: numbers.get(x.id)! } } : x,
      );
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
      exact(m, ['action', 'id', 'digest']);
      requireThat(typeof m.id === 'string' && typeof m.digest === 'string', 'Invalid approval');
      return approve(m.id, m.digest, sender);
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
  // Chrome runtime messages use JSON, unlike Firefox's structured clone. Keep
  // BigInt amounts exact as decimal strings on the UI wire; signing retains the
  // original typed review in this worker.
  void handleUI(message, sender)
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
