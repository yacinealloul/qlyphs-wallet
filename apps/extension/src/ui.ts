import { ACCOUNT_SCOPED_ACTIONS } from './account-scope.ts';
import { accountName } from './accounts.ts';
import {
  normalizeMnemonic,
  validateMnemonic,
} from '../../../packages/chain/src/browser/mnemonic.ts';
import { VAULT_PASSWORD_ERROR } from './vault.ts';
import { parseWalletBackup } from './account-backup.ts';
import { uiError } from './errors.ts';
import { passkeyPRF, passkeyError } from './passkeys.ts';
import type { PasskeyChallenge } from './passkeys.ts';
import QRCode from 'qrcode';
import { walletMotion, walletScroll } from './motion.ts';
import { formatBalance } from './format-balance.ts';
import { mountSculptures } from './sculpture.ts';
import { browser } from './browser.ts';
import { explorerURL } from './explorer-link.ts';
import { incomingBalance, spendableBalance } from './send-balance.ts';
import { VERSION, EXPLORER, PLATFORM, TESTNET, LOCAL_NETWORK, loadNetwork, reloadEndpoints, useNetwork } from './config.ts';
import { checkEndpoints, hostPatterns } from './endpoints.ts';
import type { Endpoints } from './endpoints.ts';
import { MAINNET_BUILD } from './profile.ts';
import { applyNetworkCopy, networkName } from './network-copy.ts';
import { formatUnits, parseUnits, json } from '../../native/src/commands.ts';
import { fromHex, hex } from '../../../packages/native/src/codec.ts';
import { isRateDerived } from '../../../packages/native/src/fee-schedule.ts';
import { decodeAccountId, encodeAccountId } from '../../../packages/chain/src/codec/address.ts';
import { arrive, drop, flash, nudge, pop, roll } from './feel.ts';
import { mountTipPicker } from './review-tip.ts';
import {
  blockRate,
  finality,
  stageDone,
  stageStep,
  stageText,
  trackedTransaction,
  txStage,
} from './tx-progress.ts';
import type { ChainHeights, TxStage } from './tx-progress.ts';
import {
  DETAIL_ROWS,
  LIMIT_ROWS,
  SESSION_KEY_ROWS,
  roughQtc,
  NO_SESSION,
  RELOADED_BEFORE_START,
  UI_CALL_TIMEOUT_MS,
  UI_POLL_MS,
  afterPoll,
  afterStartPoll,
  approvalBlock,
  endedLocally,
  parseMintSessionView,
  pollDelay,
  progress,
  reviewAmount,
  reviewExpiry,
  reviewRows,
  reviewTitle,
  reviewWarning,
  essentialRows,
  signingStops,
  timeLimit,
  trackerText,
} from './mint-session-view.ts';
import type {
  MintSessionReview,
  MintSessionStatus,
  MintSessionView,
  PollOutcome,
  Progress,
  Row,
  SessionAnswer,
} from './mint-session-view.ts';
import type { Asset, Review, Manifest, Status } from './network.ts';
import type { SolanaVaultReview } from './solana-vault.ts';
import { SOLANA_SLOT_MS } from '../../../packages/provider/src/solana-vault.ts';
import { renderQlyph, qlyphSize } from './qlyph-render.ts';
import { qtcMark, tokenMark } from './token-mark.ts';
import { platformURL } from './platform-link.ts';
import type { PlatformPage } from './platform-link.ts';
import type { CatalogToken, PointsView, TokenProfile } from './platform.ts';
import { collectionRole } from './collections.ts';
import { RANGES, chartPaths, defaultRange, formatPrice, marketView, unitPrice } from './market.ts';
import type { Range, Trade } from './market.ts';
import { formatUsd, formatUsdChange, formatUsdValue, USD_RANGES } from './qtc-price.ts';
import type { QtcPrice, UsdRange } from './qtc-price.ts';
import type { CollectionItem, CollectionRole, CollectionSummary, HeldCollection, Holdings } from './collections.ts';
import { FEE_KEPT, feeKept, feeValue, LOW_SUPPLY_WARNING, pendingFeeNotice, raceWarning } from './fee-copy.ts';
/** Display name of an asset: its symbol, or 'Quark #n' for a Quark (1-of-1 inscription, no symbol). */
const assetName = (a: Asset) =>
  a.definition.policy === 'inscription'
    ? a.qlyph
      ? 'Quark #' + a.qlyph.number
      : 'Quark'
    : a.definition.symbol;
const isQlyph = (a: Asset | undefined) => a?.definition.policy === 'inscription';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const value = (id: string) => $<HTMLInputElement>(id).value;
const copyTimers = new Map<HTMLElement, () => void>();
async function copyText(button: HTMLElement, text: string) {
  await navigator.clipboard.writeText(text);
  copyTimers.get(button)?.();
  const label = button.getAttribute('aria-label');
  const use = button.querySelector('use');
  const href = use?.getAttribute('href');
  const originalText = button.textContent;
  const minWidth = button.style.minWidth;
  if (use) use.setAttribute('href', '#i-check');
  else {
    button.style.minWidth = button.getBoundingClientRect().width + 'px';
    button.textContent = 'Copied';
  }
  button.dataset.copied = 'true';
  pop(button);
  button.setAttribute('aria-label', 'Copied to clipboard');
  $('copy-feedback').textContent = 'Copied to clipboard';
  const restore = () => {
    clearTimeout(timer);
    if (use && href) use.setAttribute('href', href);
    else if (!use) button.textContent = originalText;
    button.style.minWidth = minWidth;
    if (label === null) button.removeAttribute('aria-label');
    else button.setAttribute('aria-label', label);
    delete button.dataset.copied;
    copyTimers.delete(button);
  };
  const timer = setTimeout(restore, 1800);
  copyTimers.set(button, restore);
}
const motion = walletMotion(document.querySelector<HTMLElement>('.tabs')!);
const syncWalletScroll = walletScroll($('wallet'));
mountSculptures();
let pointerInput = false;
document.addEventListener(
  'pointerdown',
  () => {
    pointerInput = true;
  },
  true,
);
document.addEventListener(
  'keydown',
  () => {
    pointerInput = false;
  },
  true,
);
const params = new URL(location.href).searchParams;
const requestId = params.get('request');
const surface = requestId
  ? 'confirmation'
  : params.get('surface') === 'sidebar'
    ? 'sidebar'
    : params.get('surface') === 'tab'
      ? 'tab'
      : 'popup';
/** A site's request shown in the side panel, which returns to the wallet once it is answered. */
const inPanel = !!requestId && params.get('surface') === 'sidebar';
/** The key the background hands this panel for the request it shows: only messages that carry it
 * may read or answer that request. */
let resolvePanelKey: (key: string | undefined) => void = () => undefined;
/** The key once received, for messages sent while the page goes away. */
let panelKeyValue: string | undefined;
const panelKey = inPanel
  ? new Promise<string | undefined>((resolve) => {
      resolvePanelKey = (key) => resolve((panelKeyValue = key));
      setTimeout(() => resolve(undefined), 5000);
    })
  : undefined;
/** A message to the background, with this panel's request key when it has one. */
async function keyed(message: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = panelKey && (await panelKey);
  return key ? { ...message, panelKey: key } : message;
}
/** Reviews show the essentials. Settings → Advanced → Show transaction details adds every limit,
 * identifier and the raw payload, to check or debug an operation. Remembered per browser. */
const DETAILS_KEY = 'qlyphs.showTransactionDetails';
let showDetails = (() => {
  try {
    return localStorage.getItem(DETAILS_KEY) === '1';
  } catch {
    return false;
  }
})();
/** Leaves a request's page: its own window closes; the side panel goes back to the wallet. */
function leave(): void {
  if (inPanel) location.replace(browser.runtime.getURL('ui.html?surface=sidebar'));
  else window.close();
}
document.body.dataset.surface = surface;
document.documentElement.dataset.surface = surface;
document.documentElement.dataset.extension = String(
  ['chrome-extension:', 'moz-extension:'].includes(location.protocol),
);
// Chrome may allocate an outer scrollbar gutter when screen space caps the popup.
// Fit the root after that allocation, keeping scrolling inside the active view.
if (surface === 'popup' && document.documentElement.dataset.extension === 'true') {
  const fit = () => {
    if (innerWidth > 360 && innerHeight > 0 && innerHeight < 600)
      document.documentElement.style.height = innerHeight + 'px';
  };
  window.addEventListener('resize', () => requestAnimationFrame(fit));
  requestAnimationFrame(() => requestAnimationFrame(fit));
}
// A switchable build resolves its network before anything below reads it.
await loadNetwork();
/** Network wording, at startup and again after a switch. */
function paintNetwork() {
  $('about-version').textContent = (MAINNET_BUILD ? 'Mainnet · v' : TESTNET ? 'Testnet · v' : 'Development · v') + VERSION;
  applyNetworkCopy();
}
paintNetwork();
let passkeyAbort: AbortController | undefined;

interface WalletAccount {
  owner: string;
  address: string;
  name: string;
  backed: boolean;
  walletOwner?: string;
  derivationIndex?: number;
}
interface UIState {
  name?: string;
  accounts?: WalletAccount[];
  backgroundVersion?: string;
  display?: { mode: 'sidebar' | 'popup'; sidebar: boolean };
  passkey?: boolean;
  notifications?: { enabled: boolean; permitted: boolean; available: boolean };
  account: { owner: string; address: string; genesis: string } | null;
  unlocked: boolean;
  unlockSetup?: { name: string; remaining: number } | null;
  unlockHint?: string | null;
  backed: boolean;
  manifest: Manifest | null;
  sites: string[];
  transactions: Tx[];
  pqConfigured: boolean;
  /** Which network this wallet is on, and whether Settings may switch it. */
  network?: { active: 'development' | 'mainnet'; switchable: boolean };
  /** The active network's endpoints, the compiled ones and those the user set (Settings → Network). */
  endpoints?: {
    rpc: string;
    api: string;
    explorer: string;
    defaults: { rpc: string; api: string; explorer: string };
    custom: Endpoints;
    editable: boolean;
  };
  /** The selected account's running mint session, or its last one whose payments are not settled. */
  mintSession?: MintSessionStatus | null;
  api: string;
  rpc: string;
  extensionOrigin: string;
}
interface Tx {
  hash: string;
  label: string;
  status: string;
  nativeSuccess?: boolean | null;
  verdict?: string | null;
  /** The rejected operation's Qlyphs fee was paid and is not refunded. */
  feeKept?: boolean;
  createdAt?: number;
  height?: number;
  amount?: string;
  to?: string;
  symbol?: string;
  decimals?: number;
  /** The token it moves or mints. */
  asset?: string;
  /** Set on the payments of a mint session: the session and the lot it paid for. */
  session?: string;
  lot?: number;
  /** The network fee estimate plus tip at signing (planck). */
  fee?: string;
  /** The Qlyphs fee and native charges the review showed (planck), when above zero. */
  qlyphsFee?: string;
  charges?: string;
}
interface Confirmation {
  kind: string;
  origin: string;
  account: { owner: string; address: string; genesis: string };
  expires: number;
  review: Review | null;
  digest: string;
  unlocked: boolean;
  /** A mint session's review, and when the unlock ends (it bounds the session's signing time). */
  session?: MintSessionReview;
  unlockDeadline?: number;
  /** A site sign-in: what the session lets the site do, and when it ends. */
  signIn?: { actions: string[]; expiresAt: number };
  /** A Solana vault authorization, as the wallet decoded it (development builds only). */
  solanaVault?: SolanaVaultReview;
}
let state: UIState | undefined,
  pending: Confirmation | undefined,
  candidate: Status | undefined,
  assets: Asset[] = [],
  busy = false;
let resetOwner: string | undefined;
/** The account whose points are shown; cleared on lock so the next unlock reads them again. */
let pointsOwner: string | undefined;
let resetBackupSaved = false;
let renamedOwner: string | undefined;
let balanceRequest = 0;
let pendingBalanceRequests = 0;
let lastBalanceRefresh = 0;
let renderRequest = 0;
let watchOnly = false,
  privateBalances = false,
  freeBalance: bigint | undefined,
  balanceView: BalanceView | undefined;
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
interface BalanceView {
  owner?: string;
  balance: {
    free: string;
    reserved: string;
    frozen: string;
    finalized?: { free: string; frozen: string };
  };
  assets: Asset[];
  more: boolean;
  transactions: Tx[];
  chain?: ChainHeights;
}
const labels: Record<string, string> = {
  sendQtc: 'Send QTC',
  transfer: 'Transfer tokens',
  deploy: 'Create token',
  deployProgressive: 'Create progressive token',
  deployProgressiveV2: 'Create progressive token',
  mint: 'Mint tokens',
  mintProgressive: 'Mint a lot',
  pair: 'Create trading pair',
  sell: 'Reserve tokens for sale',
  buy: 'Buy tokens',
  cancel: 'Cancel reservation',
  inscribe: 'Create a Quark',
};
const short = (v: string) => (v.length > 20 ? v.slice(0, 8) + '…' + v.slice(-6) : v);
function icon(name: string) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    use = document.createElementNS(svg.namespaceURI, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.setAttribute('aria-hidden', 'true');
  svg.append(use);
  return svg;
}
function paintAccountAvatar(element: HTMLElement, owner: string) {
  let hash = 2166136261;
  for (const char of owner) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = (hash ^ (hash >>> 13)) >>> 0;
  element.dataset.tone = String(hash % 6);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  const motifs = [
    'M6 16 16 6 26 16v10H6Z',
    'M6 6h20L6 26Zm20 20H12l14-14Z',
    'M6 6h10v10h10v10H6Z',
    'M16 4 28 16 16 28 4 16Z',
  ];
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', motifs[(hash >>> 4) % motifs.length]!);
  svg.append(path);
  element.replaceChildren(svg);
}
function empty(title: string, description: string, symbol = 'wallet') {
  const e = node('div', '', 'empty-state');
  e.append(icon(symbol), node('strong', title), node('p', description));
  return e;
}

async function call<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const r = (await browser.runtime.sendMessage(
    await keyed({
      action,
      ...params,
      ...(ACCOUNT_SCOPED_ACTIONS.has(action) ? { expectedOwner: state?.account?.owner } : {}),
    }),
  )) as {
    result: T;
    error?: string;
  };
  if (r.error) throw Error(r.error);
  return r.result;
}
function backgroundNeedsUpdate() {
  return (
    !!state &&
    (document.documentElement.dataset.extension === 'true' ||
      state.backgroundVersion !== undefined) &&
    state.backgroundVersion !== VERSION
  );
}
function message(text: string, error = false, transient = false) {
  clearTimeout(feedbackTimer);
  networkInspection++;
  const updatePending = backgroundNeedsUpdate();
  if (updatePending) {
    text = 'Wallet update pending. Reload the extension to finish updating.';
    error = true;
    transient = false;
  }
  const changedNetwork = error && text === 'Network configuration changed; reconnect explicitly';
  $('network-help').hidden = !changedNetwork && !updatePending;
  $('retry-wallet-network').hidden = updatePending;
  $('inspect-network').hidden = updatePending;
  $('reload-extension').hidden = !browser.runtime.reload;
  $('network-reload-hint').hidden = !browser.runtime.reload;
  $('network-reload-hint').textContent = updatePending
    ? `Interface v${VERSION} · Background ${state?.backgroundVersion ? 'v' + state.backgroundVersion : 'version unavailable'}. Reload keeps your saved wallet and locks it.`
    : 'Reload keeps your saved wallet and locks it.';
  $('connection-details').hidden = true;
  $('inspect-network').setAttribute('aria-expanded', 'false');
  $('message').textContent = changedNetwork
    ? 'Checking the saved network… Sending is paused.'
    : text;
  if (changedNetwork && state?.manifest)
    pairs('connection-values', [
      ['Interface version', VERSION],
      ['Background version', state.backgroundVersion ?? 'Not reported'],
      ['Saved genesis', state.manifest.genesis],
      ['Node', state.rpc],
      ['Service', state.api],
    ]);
  $('message').classList.toggle('error', error);
  $('message').classList.toggle('success', transient && !error);
  if (text && error) requestAnimationFrame(() => nudge($('message')));
  else if (text && transient) requestAnimationFrame(() => drop($('message')));
  if (error) $('feedback').scrollTop = 0;
  if (transient)
    feedbackTimer = setTimeout(() => {
      $('message').textContent = '';
    }, 4000);
}
function syncControls() {
  const canReset =
    !!state?.account && !state.unlocked && (state.accounts?.length ?? 1) === 1 && !requestId;
  $('open-reset').hidden = !canReset;
  if (!canReset || (resetOwner && resetOwner !== state?.account?.owner))
    $<HTMLDialogElement>('reset-dialog').close();
  $<HTMLButtonElement>('confirm-reset').disabled =
    busy || !canReset || !resetBackupSaved || !$<HTMLInputElement>('reset-confirm').checked;
  const selector = $<HTMLButtonElement>('open-accounts');
  const accountControls =
    !!state?.account && !!state.unlocked && !!$('recovery').hidden;
  selector.hidden = !accountControls;
  $('copy-address').hidden = !accountControls;
  selector.disabled = busy || !!requestId || !accountControls;
  document.body.dataset.accountControls = String(accountControls);
  if (!state?.unlocked) {
    $('points-badge').hidden = true;
    pointsOwner = undefined;
  }
  if (!accountControls) {
    $<HTMLDialogElement>('account-drawer').close();
    $<HTMLDialogElement>('accounts-dialog').close();
    $<HTMLDialogElement>('tx-sheet').close();
    $<HTMLDialogElement>('recipient-sheet').close();
    $('accounts-list').replaceChildren();
    $<HTMLInputElement>('account-name').value = '';
    renamedOwner = undefined;
  }
  const migration = state?.unlockSetup;
  $('unlock-intro').hidden = !migration && !state?.unlockHint;
  $('unlock-title').textContent = migration ? 'Link your saved wallets' : 'Welcome back';
  $('unlock-intro').textContent = migration
    ? `Enter the old password for ${migration.name} once. ${migration.remaining} ${migration.remaining === 1 ? 'wallet' : 'wallets'} to link.`
    : state?.unlockHint
      ? `Use the password of your first wallet (${state.unlockHint}) to set up one unlock for all wallets.`
      : 'One password unlocks all your wallets on this device.';
  $('unlock-submit').textContent = migration ? 'Link wallet' : 'Unlock Qlyphs';
  $('cancel-unlock').hidden = !requestId;
  $<HTMLButtonElement>('cancel-unlock').disabled = busy;
  $('active-account-name').textContent = state?.name ?? 'Account 1';
  if (state?.account) paintAccountAvatar($('header-wallet-avatar'), state.account.owner);
  selector.title = state?.name ?? 'Switch account';
  selector.setAttribute('aria-label', `Switch account, ${state?.name ?? 'Account 1'}`);
  $('refresh').hidden = !state?.account || $('wallet').hidden;
  $('lock').hidden = !state?.account || !state?.unlocked;
  $('return-unlock').hidden = !state?.account || !!state?.unlocked || !watchOnly;
  $<HTMLButtonElement>('acknowledge').disabled =
    busy || recoveryPage !== recoveryPages + 1 || !$<HTMLInputElement>('saved-phrase').checked;
  for (const id of ['export', 'reveal-password'])
    $<HTMLButtonElement | HTMLInputElement>(id).disabled = busy || !state?.unlocked;
  $<HTMLButtonElement>('reveal-form').querySelector<HTMLButtonElement>('button')!.disabled =
    busy || !state?.unlocked;
  $('backup-reminder').hidden = !state?.account || !!state?.backed;
  $('wallet-state').textContent = state?.unlocked ? '' : 'Watch-only · Unlock to send assets';
  syncPreferences();
  guardApproval();
}
function syncViews() {
  const recovery = !$('recovery').hidden;
  const wasUnlocking = !$('unlock').hidden;
  const wasReviewing = !$('confirmation').hidden;
  $('new-wallet').hidden = !state?.manifest || !!state.account || !!requestId;
  $('unlock').hidden = !state?.account || !!state?.unlocked || watchOnly || recovery;
  $('wallet').hidden = !state?.account || !!requestId || (!state.unlocked && !watchOnly) || recovery;
  $('confirmation').hidden =
    !requestId ||
    !pending ||
    !state?.unlocked ||
    !pending.unlocked ||
    recovery ||
    !!sent ||
    !!minting;
  $('tx-result').hidden = !requestId || !sent;
  $('mint-session').hidden = !requestId || !minting;
  // A lock ends signing; the progress shows it in place, never the unlock form.
  if (sent || minting) $('unlock').hidden = true;
  syncControls();
  if (requestId && !wasReviewing && !$('confirmation').hidden) {
    $('confirmation').querySelector('.review-content')!.scrollTop = 0;
    $('review-title').focus({ preventScroll: true });
  } else if (requestId && !wasUnlocking && !$('unlock').hidden) {
    $('password').focus({ preventScroll: true });
  }
}

function node(tag: string, text: string, className = ''): HTMLElement {
  const e = document.createElement(tag);
  e.textContent = text;
  e.className = className;
  return e;
}
function pairs(id: string, items: readonly Row[]) {
  if (id !== 'review-summary') {
    $(id).replaceChildren(...items.flatMap(([k, v]) => [node('dt', k), node('dd', v)]));
    return;
  }
  // Keep exact identifiers and charges available without making every review a stack of cards.
  // Only a session review has limits of its own: other reviews may reuse a label such as `Lots`.
  // A session review leads with what it can cost and when it stops; the rest folds into sections.
  const session = pending?.kind === 'session';
  const details =
    pending?.kind === 'signin'
      ? 'Sign-in'
      : pending?.kind === 'vault'
        ? 'Vault payment'
        : session
          ? 'Token'
          : 'Transaction details';
  const groups = new Map<string, Row[]>();
  for (const item of items) {
    const title =
      session && SESSION_KEY_ROWS.test(item[0])
        ? ''
        : session && LIMIT_ROWS.test(item[0])
        ? 'Limits'
        : session && DETAIL_ROWS.test(item[0])
          ? 'Token'
          : /^(Network|Signing account|Genesis)$/.test(item[0])
            ? 'Account & network'
            : /^(Network fee|Priority tip$|Native |Qlyphs fee$|Qlyphs fee change$|Estimated total)/.test(item[0])
              ? 'Estimated fees'
              : details;
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title)!.push(item);
  }
  const rows = (values: readonly Row[], recipientOnly = false) => {
    const list = node('dl', '', 'rows');
    for (const [k, v] of values) {
      const row = node(
        'div',
        '',
        'review-row' +
          (/recipient|account|genesis|asset ID|buyer|payout|from vault/i.test(k) ? ' identifier' : '') +
          (k === 'Estimated total' || k === 'Maximum protocol spend' ? ' review-total' : ''),
      );
      row.append(node('dt', k, recipientOnly ? 'sr-only' : ''), rowValue(k, v));
      list.append(row);
    }
    return list;
  };
  $('review-summary').replaceChildren(
    ...[...groups].map(([title, values]) => {
      if (title === 'Account & network' && !showDetails && pending)
        return reviewList([
          [
            accountLabel(pending.kind),
            accountLine(pending.account.address),
          ],
        ]);
      if (title === 'Account & network') {
        const group = node('details', '', 'review-disclosure review-account');
        const summary = node('summary', '');
        const account = node('span', state?.name ?? 'Your account', 'review-account-name');
        if (pending) account.append(node('small', short(pending.account.address)));
        summary.append(
          node(
            'span',
            pending?.kind ? accountLabel(pending.kind) : 'Sending from',
          ),
          account,
        );
        group.append(summary, rows(values));
        return group;
      }
      if (session && title) {
        const fold = node('details', '', 'review-disclosure review-section');
        fold.append(node('summary', title), rows(values));
        return fold;
      }
      const group = node('section', '', 'review-group');
      const recipientOnly = values.length === 1 && values[0]![0] === 'Recipient';
      if (title) group.append(node('h2', recipientOnly ? 'To' : title));
      const heading = group.querySelector('h2')!;
      if (recipientOnly) {
        const copy = node('button', 'Copy', 'text-button review-copy') as HTMLButtonElement;
        copy.type = 'button';
        copy.setAttribute('aria-label', 'Copy recipient address');
        copy.addEventListener('click', () => void task(() => copyText(copy, values[0]![1]), copy));
        heading.append(copy);
      }
      const zeroFees =
        title === 'Estimated fees'
          ? values.filter(([k, v]) => /^(Native |Qlyphs fee$)/.test(k) && v === '0 QTC')
          : [];
      // A token's full ID stays one tap away instead of filling the review.
      const tokenId = values.filter(([k]) => k === 'Full asset ID');
      group.append(
        rows(
          values.filter((value) => !zeroFees.includes(value) && !tokenId.includes(value)),
          recipientOnly,
        ),
      );
      if (tokenId.length && showDetails) {
        const fold = node('details', '', 'review-disclosure review-token-id');
        fold.append(node('summary', 'Token ID'), rows(tokenId));
        group.append(fold);
      }
      if (zeroFees.length) {
        const details = node('details', '', 'review-disclosure review-zero-fees');
        details.append(node('summary', 'Other fees · 0 QTC'), rows(zeroFees));
        group.append(details);
      }
      return group;
    }),
  );
}

async function task(work: () => Promise<void>, trigger?: HTMLElement) {
  if (busy) return;
  busy = true;
  document.body.dataset.busy = 'true';
  $('main').setAttribute('aria-busy', 'true');
  const controls = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
    // Stop, and Done once signing ended, stay usable whatever else the window is doing.
    (b) =>
      !b.disabled &&
      !b.matches('[role=tab], [data-password], #hide-balance, #mint-session-stop, #mint-session-done'),
  );
  for (const button of controls) {
    button.disabled = true;
    button.dataset.busyDisabled = 'true';
  }
  const button = trigger instanceof HTMLButtonElement ? trigger : undefined;
  button?.setAttribute('aria-busy', 'true');
  const waiting = setTimeout(() => {
    if (button) button.dataset.waiting = 'true';
  }, 150);
  try {
    await work();
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Wallet operation failed';
    message(error, true);
    if (!backgroundNeedsUpdate() && error === 'Network configuration changed; reconnect explicitly')
      await inspectConnection(true);
  } finally {
    busy = false;
    clearTimeout(waiting);
    button?.removeAttribute('aria-busy');
    if (button) delete button.dataset.waiting;
    document.body.dataset.busy = 'false';
    $('main').removeAttribute('aria-busy');
    for (const button of controls) {
      button.disabled = false;
      delete button.dataset.busyDisabled;
    }
    syncControls();
    if ($<HTMLDialogElement>('accounts-dialog').open && !$('accounts-overview').hidden) {
      const count = state?.accounts?.length ?? 1;
      $<HTMLButtonElement>('add-account').disabled =
        !state?.unlocked || !state.backed || count >= 20;
    }
  }
}
let approvalNote = '';
function guardApproval() {
  const now = Date.now();
  // A locked wallet reports no unlock deadline; the unlock form explains that case instead.
  const blocked =
    pending?.kind === 'session' && pending.session && pending.unlocked && state?.unlocked
      ? approvalBlock(pending.session, pending.unlockDeadline ?? 0, now)
      : null;
  $<HTMLButtonElement>('approve').disabled =
    busy ||
    !pending ||
    !state?.unlocked ||
    !pending.unlocked ||
    now >= pending.expires ||
    ((pending.kind === 'transaction' || pending.kind === 'signin' || pending.kind === 'vault') &&
      (!state?.unlocked || !state.backed)) ||
    (pending.kind === 'session' && (!pending.session || !state?.backed || blocked !== null));
  $<HTMLButtonElement>('reject').disabled = busy;
  // Say once why a session cannot start; the guard runs every second.
  if (blocked && blocked !== approvalNote) message(blocked, true);
  approvalNote = blocked ?? '';
}
type OnboardingScreen =
  | 'choice'
  | 'create'
  | 'import-choice'
  | 'phrase'
  | 'import-password'
  | 'backup'
  | 'restore-password';
let onboardingScreen: OnboardingScreen = 'choice';
let recoveryPage = 0;
let recoveryPages = 0;
const onboardingHints: Record<string, string> = {
  'new-password': 'password-hint',
  'confirm-password': 'confirm-hint',
  'import-phrase': 'phrase-hint',
  'import-password': 'import-password-hint',
  'backup-file': 'backup-file-hint',
  'restore-password': 'restore-password-hint',
};
const defaultHints = Object.fromEntries(
  Object.values(onboardingHints).map((id) => [id, $(id).textContent!.trim()]),
);
function fieldFeedback(id: string, error?: string) {
  const hint = $(onboardingHints[id]!);
  hint.textContent = error ?? defaultHints[hint.id]!;
  hint.classList.toggle('field-error', !!error);
  if (error) $(id).setAttribute('aria-invalid', 'true');
  else $(id).removeAttribute('aria-invalid');
}
function phraseCount() {
  const phrase = normalizeMnemonic(value('import-phrase'));
  const count = phrase ? phrase.split(' ').length : 0;
  $('phrase-word-count').textContent = `${count} ${count === 1 ? 'word' : 'words'}`;
}
function continueImport() {
  const input = $<HTMLTextAreaElement>('import-phrase');
  if (busy || !input.reportValidity()) return;
  const normalized = normalizeMnemonic(input.value);
  if (!validateMnemonic(normalized)) {
    const count = normalized.split(' ').length;
    fieldFeedback(
      'import-phrase',
      [12, 15, 18, 21, 24].includes(count)
        ? 'Check the words and their order. This phrase is not valid.'
        : 'Enter a complete phrase: 12, 15, 18, 21 or 24 words.',
    );
    input.focus({ preventScroll: true });
    return;
  }
  input.value = normalized;
  fieldFeedback('import-phrase');
  phraseCount();
  message('');
  onboarding('import-password');
}
async function readBackup() {
  const file = $<HTMLInputElement>('backup-file').files?.[0];
  if (!file || file.size > 32768) throw Error('Choose a JSON backup of up to 32 KB.');
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw Error('This file is not valid JSON. Choose your Qlyphs backup.');
  }
  try {
    return parseWalletBackup(data, state!.manifest!.genesis);
  } catch {
    throw Error('This backup is not compatible with this wallet or network.');
  }
}
function onboarding(screen: OnboardingScreen, focus = true) {
  onboardingScreen = screen;
  for (const view of document.querySelectorAll<HTMLElement>('[data-onboarding-screen]')) {
    view.hidden = view.dataset.onboardingScreen !== screen;
    // Hidden steps must not participate in native form validation or keyboard navigation.
    for (const input of view.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input, textarea',
    ))
      input.disabled = view.hidden;
  }
  $('onboarding-back').hidden = screen === 'choice';
  $('onboarding-progress').textContent = {
    choice: 'Set up your wallet',
    create: 'Create wallet',
    'import-choice': 'Import wallet',
    phrase: 'Recovery phrase · 1 of 2',
    'import-password': 'Recovery phrase · 2 of 2',
    backup: 'Encrypted backup · 1 of 2',
    'restore-password': 'Encrypted backup · 2 of 2',
  }[screen];
  const view = document.querySelector<HTMLElement>(`[data-onboarding-screen="${screen}"]`)!;
  view.querySelector('.wizard-content')?.scrollTo(0, 0);
  if (focus) view.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  motion.reveal(view, focus && pointerInput, true);
}
function recoveryStep(page: number, focus = true) {
  recoveryPage = Math.max(0, Math.min(page, recoveryPages + 1));
  const intro = recoveryPage === 0;
  const confirm = recoveryPage === recoveryPages + 1;
  $('recovery-back').hidden = intro;
  $('recovery-progress').textContent = intro
    ? 'Back up your wallet'
    : confirm
      ? 'One last check'
      : `Recovery words · ${recoveryPage} of ${recoveryPages}`;
  $('recovery-title').textContent = intro
    ? 'Your way back in'
    : confirm
      ? 'All safely saved?'
      : `Words ${(recoveryPage - 1) * 12 + 1}–${Math.min(recoveryPage * 12, $('phrase').childElementCount)}`;
  $('recovery-description').textContent = intro
    ? 'Your recovery words restore your wallet if you lose access to this device.'
    : confirm
      ? 'Keep your words offline. Qlyphs cannot recover them for you: lose them and the wallet is gone.'
      : 'Write these down in order. Keep them private.';
  $('recovery-warning').hidden = !intro;
  $('phrase').hidden = intro || confirm;
  [...$('phrase').children].forEach((word, i) => {
    (word as HTMLElement).hidden = intro || confirm || Math.floor(i / 12) !== recoveryPage - 1;
  });
  $('recovery-check').hidden = !confirm;
  $('words-file-note').hidden = !confirm;
  $('download-words').hidden = !confirm;
  $('acknowledge').hidden = !confirm;
  $('recovery-next').hidden = confirm;
  $('recovery-next').replaceChildren(
    document.createTextNode(
      intro
        ? 'Show recovery words '
        : recoveryPage === recoveryPages
          ? 'I wrote down all my words '
          : 'Next 12 words ',
    ),
    icon('up'),
  );
  if (focus) $('recovery-title').focus({ preventScroll: true });
  syncControls();
  motion.reveal(
    $('recovery').querySelector<HTMLElement>('.wizard-content')!,
    focus && pointerInput,
    true,
  );
}
function showPhrase(phrase: string) {
  $('phrase').replaceChildren(
    ...phrase
      .trim()
      .split(/\s+/)
      .map((word, i) => {
        const e = node('span', word + ' ', 'secret-word');
        e.dataset.index = String(i + 1).padStart(2, '0');
        return e;
      }),
  );
  $('recovery').hidden = false;
  $('new-wallet').hidden = true;
  $<HTMLInputElement>('saved-phrase').checked = false;
  recoveryPages = Math.ceil($('phrase').childElementCount / 12);
  recoveryStep(0);
  syncViews();
  $('recovery').scrollTop = 0;
}
function clearSecrets() {
  unlockFeedback();
  for (const id of [
    'new-password',
    'confirm-password',
    'import-password',
    'import-phrase',
    'restore-password',
    'password',
    'reveal-password',
    'passkey-password',
    'remove-passkey-password',
  ])
    $<HTMLInputElement>(id).value = '';
  for (const toggle of document.querySelectorAll<HTMLButtonElement>('[data-password]')) {
    $<HTMLInputElement>(toggle.dataset.password!).type = 'password';
    toggle.setAttribute('aria-label', 'Show password');
    toggle.setAttribute('aria-pressed', 'false');
  }
  $('password-meter').removeAttribute('data-level');
  for (const id of Object.keys(onboardingHints)) fieldFeedback(id);
  phraseCount();
}
async function render() {
  pending = undefined;
  guardApproval();
  const request = ++renderRequest;
  const next = await call<UIState>('status');
  if (request !== renderRequest) return;
  if (state?.account?.owner !== next.account?.owner) resetAccountView();
  state = next;
  $('setup').hidden = !!state.manifest || !!requestId;
  $('new-wallet').hidden = !state.manifest || !!state.account || !!requestId;
  if (!state.unlocked) {
    $('phrase').textContent = '';
    $('recovery').hidden = true;
    clearSecrets();
  }
  syncViews();
  if (!state.manifest && !requestId) {
    $<HTMLButtonElement>('use-network').hidden = true;
    // Keep the background's own refusal (wrong runtime, stale indexer); only an empty answer means nothing is listening.
    $('retry-network').hidden = false;
    candidate = await call<Status>('network');
    if (!candidate?.manifest)
      throw Error(MAINNET_BUILD ? 'Cannot reach the Quantus network. Check your connection, then reopen the wallet.'
        : 'Your local Quantus node is not reachable. Start it, then reopen the wallet.');
    $<HTMLButtonElement>('use-network').hidden = false;
    $('retry-network').hidden = true;
    pairs('network-details', [
      ['Node RPC', state.rpc],
      ['Service', state.api],
      ['Genesis', candidate.manifest.genesis],
      ['Activation', `Height ${candidate.manifest.activation.height}`],
      ['Runtime', candidate.manifest.runtimeHash],
      ['Extension origin', state.extensionOrigin],
    ]);
    message('');
    return;
  }
  if (state.account) {
    $('address').textContent = 'Copy address ' + state.account.address;
    $('copy-address').title = 'Copy ' + state.account.address;
    $('receive-address').textContent = state.account.address;
    pairs('account-rows', [
      ['Address', state.account.address],
      ['Account ID', state.account.owner],
      ['Network', networkName()],
      ...(state.manifest
        ? ([
            ['Genesis', state.manifest.genesis],
            ['Runtime', state.manifest.runtimeHash],
          ] as const)
        : []),
    ]);
    $('account-details').textContent = JSON.stringify(
      { ...state.account, manifest: state.manifest },
      null,
      2,
    );
    $('wallet-state').textContent = state.unlocked ? '' : 'Watch-only · Unlock to send assets';
    $('lock').hidden = !state.unlocked;
    const sites = state.sites.map((origin) => {
      const item = node('div', '', 'item');
      item.append(node('p', origin));
      const b = node('button', 'Revoke', 'secondary');
      b.addEventListener(
        'click',
        () =>
          void task(async () => {
            await call('revoke', { origin });
            await render();
            message(`${origin} can no longer see your account.`, false, true);
          }),
      );
      item.append(b);
      return item;
    });
    $('sites').replaceChildren(
      ...(sites.length
        ? sites
        : [
            empty(
              'No sites connected',
              'Sites you approve will appear here. You can revoke access at any time.',
              'link',
            ),
          ]),
    );
    renderHistory(state.transactions);
  }
  if (requestId && !sent && !minting) {
    try {
      pending = await call<Confirmation>('review', { id: requestId });
    } catch (error) {
      // A reloaded progress window has no review left, but its session may still be known.
      const restored = await sessionCall('session-state', { request: requestId, page: PAGE });
      // Or the reload cancelled an approval that had not started its session yet.
      if (restored.kind === 'error' && restored.error === RELOADED_BEFORE_START)
        throw Error(RELOADED_BEFORE_START, { cause: error });
      if (restored.kind !== 'view') throw error;
      showSession(restored.view);
      message('');
      return;
    }
    state.unlocked = pending.unlocked;
    if (pending.kind === 'session') {
      if (!pending.session) throw Error('Invalid mint session review');
      renderSessionReview(pending, pending.session);
      message('');
      approvalNote = '';
      syncViews();
      return;
    }
    if (pending.kind === 'signin') {
      if (!pending.signIn) throw Error('Invalid sign-in review');
      renderSignInReview(pending, pending.signIn);
      message('');
      approvalNote = '';
      syncViews();
      return;
    }
    if (pending.kind === 'vault') {
      if (!pending.solanaVault) throw Error('Invalid vault review');
      renderSolanaVaultReview(pending, pending.solanaVault);
      message('');
      approvalNote = '';
      syncViews();
      return;
    }
    document.getElementById('review-rules')?.remove();
    $('review-title').textContent =
      pending.kind === 'connect'
        ? 'Connect to this site?'
        : (labels[String(pending.review!.command.kind)] ?? 'Review transaction');
    $('review-origin').textContent = pending.origin;
    $('approve').textContent = pending.kind === 'connect' ? 'Connect' : 'Approve transaction';
    $('review-full-label').textContent =
      pending.kind === 'connect' ? 'Technical details' : 'Full transaction details';
    const rows: [string, string][] = [];
    $('review-amount').hidden = true;
    $('review-qlyph').hidden = true;
    $('review-qlyph').replaceChildren();
    // Any operation but a creation or inscription may carry a priority tip.
    const tippable = !!pending.review && !isRateDerived(String(pending.review.command.kind));
    const networkFee = BigInt(pending.review?.intent.costs.networkFee ?? '0');
    tipPicker.show(tippable ? (pending.review!.tip ?? '0') : null, (tip) => networkFee + tip);
    tipNote(pending.review?.command.kind === 'mintProgressive' ? 'lot' : 'operation');
    if (pending.review) {
      const r = pending.review,
        c = r.command,
        offer = (c.kind === 'sell' ? c.offer : r.ticket?.offer) as
          Record<string, unknown> | undefined;
      if (!labels[String(c.kind)]) rows.push(['Action', String(c.kind)]);
      if (c.kind === 'transfer' && r.asset)
        $('review-title').textContent = 'Send ' + assetName(r.asset);
      // Quark content is shown only through the safe renderer (images via data: URL, text escaped).
      if (c.kind === 'inscribe') {
        $('review-qlyph').replaceChildren(
          renderQlyph(document, String(c.contentType), String(c.content), 'New Quark'),
        );
        $('review-qlyph').hidden = false;
        // Read from the bytes being signed, never from the site: what this Quark is to a collection.
        const role = collectionRole(String(c.contentType), String(c.content));
        if (role) {
          $('review-title').textContent = {
            mint: `Mint from ${role.symbol}`,
            deploy: `Create collection ${role.symbol}`,
            add: `Add to collection ${role.symbol}`,
            layers: `Art for collection ${role.symbol}`,
          }[role.role];
          rows.push([
            'Collection',
            role.role === 'mint'
              ? `${role.symbol} · counts if the collection's rules accept it; the Quark is yours either way`
              : role.symbol,
          ]);
        }
        rows.push(
          ['Content type', String(c.contentType)],
          ['Size', qlyphSize((String(c.content).length - 2) / 2)],
          ['Supply', '1 of 1 · numbered in order of inclusion'],
        );
      } else if (r.asset?.qlyph?.content && r.asset.qlyph.contentType) {
        $('review-qlyph').replaceChildren(
          renderQlyph(document, r.asset.qlyph.contentType, r.asset.qlyph.content, assetName(r.asset)),
        );
        $('review-qlyph').hidden = false;
      }
      const lot = r.progressive;
      if (c.kind === 'mintProgressive' && lot && r.asset) {
        $('review-amount').replaceChildren(
          node('span', formatUnits(BigInt(lot.amount), r.asset.definition.decimals), 'review-quantity'),
          document.createTextNode(' '),
          node('span', assetName(r.asset), 'review-currency'),
        );
        $('review-amount').hidden = false;
      }
      if (c.kind === 'sendQtc' || (c.kind === 'transfer' && r.asset)) {
        $('review-amount').replaceChildren(
          node(
            'span',
            formatUnits(
              BigInt(String(c.amount)),
              c.kind === 'sendQtc' ? 12 : r.asset!.definition.decimals,
            ),
            'review-quantity',
          ),
          document.createTextNode(' '),
          node(
            'span',
            c.kind === 'sendQtc' ? 'QTC' : assetName(r.asset!),
            'review-currency',
          ),
        );
        $('review-amount').hidden = false;
      }
      if (c.kind === 'sendQtc') rows.push(['Recipient', fullAddress(String(c.to))]);
      if (r.asset) {
        rows.push(['Asset', assetName(r.asset)], ['Full asset ID', r.asset.id]);
        const amount = c.amount ?? offer?.amount;
        if (amount !== undefined)
          rows.push([
            'Token quantity',
            formatUnits(BigInt(String(amount)), r.asset.definition.decimals),
          ]);
      }
      if (c.to && c.kind !== 'sendQtc')
        rows.push(['Recipient', fullAddress(String(c.to))], ['Recipient account ID', String(c.to)]);
      if (c.kind === 'deploy')
        rows.push(
          ['Symbol', String(c.symbol)],
          ['Decimals', String(c.decimals)],
          ['Supply cap (base units)', String(c.cap)],
          ['Mint limit (base units)', String(c.limit)],
          ['Mint policy', String(c.policy)],
        );
      if (c.kind === 'deployProgressive' || c.kind === 'deployProgressiveV2')
        rows.push(
          ['Symbol', String(c.symbol)],
          ['Decimals', String(c.decimals)],
          ['Supply cap (base units)', String(c.cap)],
          ['Lots', '1000 equal lots of ' + String(BigInt(String(c.cap)) / 1000n) + ' base units'],
          [
            'Mint',
            'Anyone, one lot at a time, ' +
              (c.kind === 'deployProgressive' ? '0.1 to 0.5' : '0.01 to 0.44') +
              ' QTC per lot',
          ],
        );
      if (c.kind === 'mintProgressive' && lot && r.asset) {
        const after = BigInt(lot.lot);
        rows.push(
          ['Lot', lot.lot + ' / ' + lot.lots],
          ['Tokens received', formatUnits(BigInt(lot.amount), r.asset.definition.decimals) + ' ' + assetName(r.asset)],
          ['Minted after this lot', after + ' / 1000 lots · ' + (Number(after) / 10).toFixed(1) + '%'],
          ['Mint right', 'block ' + lot.anchor.height + ' · position ' + lot.anchor.index + ' · ' + short(lot.anchor.hash)],
          ['Attested at block', String(lot.block.height)],
        );
      }
      if (c.kind === 'pair')
        rows.push(['Buyer', String(c.buyer)], ['Multisig threshold', '2 of 2']);
      if (offer)
        rows.push(
          ['Buyer', String(offer.buyer)],
          ['Seller payout', String(offer.payout)],
          ['Price', formatUnits(BigInt(String(offer.price)), 12) + ' QTC'],
          ...(c.kind === 'buy'
            ? []
            : ([
                ['Qlyphs sale fee (buyer pays)', '1% · ' + formatUnits(BigInt(String(offer.fee)), 12) + ' QTC'],
              ] as [string, string][])),
          ['Qlyphs fee account', String(offer.feeTo)],
          ['Expiry block', String(offer.expiry)],
        );
      const f = r.intent.costs;
      // QLYP-v1 Qlyphs fee: creating a token or a Quark from the attested on-chain rate, 0.01 QTC
      // per mint, 1% of a purchase price.
      const qlyphsFee = formatUnits(BigInt(f.platformFee), 12) + ' QTC';
      const pendingFee = r.fees ? pendingFeeNotice(r.fees) : null;
      rows.push(
        ['Qlyphs fee', r.fees ? feeValue(r.fees) : c.kind === 'buy' ? '1% · ' + qlyphsFee : qlyphsFee],
        ...(pendingFee ? ([['Qlyphs fee change', pendingFee]] as [string, string][]) : []),
        // A review that can carry a tip shows its network fee as one row that opens the fee sheet.
        ...((tipPicker.active
          ? [
              ['Network fee', '≈ ' + roughQtc(BigInt(f.networkFee) + BigInt(r.tip ?? '0'))],
              ...(showDetails && r.tip ? [['Priority tip', formatUnits(BigInt(r.tip), 12) + ' QTC']] : []),
            ]
          : [['Network fee estimate', formatUnits(BigInt(f.networkFee), 12) + ' QTC']]) as [string, string][]),
        ['Native non-refundable charge', formatUnits(BigInt(f.nativeFee), 12) + ' QTC'],
        ['Native refundable deposit', formatUnits(BigInt(f.deposit), 12) + ' QTC'],
      );
      const spent =
        c.kind === 'sendQtc'
          ? BigInt(String(c.amount))
          : c.kind === 'buy' && offer
            ? BigInt(String(offer.price))
            : c.kind === 'deploy' ||
                c.kind === 'mint' ||
                c.kind === 'inscribe' ||
                c.kind === 'deployProgressive' ||
                c.kind === 'deployProgressiveV2' ||
                c.kind === 'mintProgressive'
              ? 0n
              : undefined;
      if (spent !== undefined) {
        const total =
          spent +
          BigInt(f.networkFee) +
          BigInt(f.nativeFee) +
          BigInt(f.deposit) +
          BigInt(f.platformFee) +
          BigInt(r.tip ?? '0');
        rows.push(['Estimated total', formatUnits(total, 12) + ' QTC']);
      }
      $('review-warning').textContent =
        c.kind === 'inscribe'
          ? 'A Quark is the equivalent of an NFT: unique, numbered content with a single owner. Its content is public and permanent. Every Quantus transaction is signed with ML-DSA (post-quantum), so this Quark\'s provenance is bound to a post-quantum signature on chain. Its number is assigned at inclusion. Fees are estimates.'
          : c.kind === 'buy'
          ? 'Before signing, this extension requires matching, fresh ML-DSA attestations from both configured witnesses. These are operator claims, not consensus proofs. Network fees are estimates.'
          : c.kind === 'mintProgressive'
          ? 'This lot and its price come from fresh ML-DSA attestations by both configured witnesses. If someone mints this lot first, your transaction fails on chain: you pay the network fee and your priority tip, never the Qlyphs fee. Fees are estimates.'
          : 'Fees are estimates, not a guaranteed cap. Approval signs only this operation.';
      // A deploy can lose its fee to another claim of the symbol; a mint, to the cap.
      const notices = [
        r.fees && typeof c.symbol === 'string'
          ? raceWarning(c.symbol, r.fees.fee, r.notice?.pooled === true)
          : '',
        c.kind === 'mint' && r.notice?.lowSupply ? LOW_SUPPLY_WARNING : '',
      ].filter(Boolean);
      if (notices.length) {
        $('review-warning').textContent = notices.join(' ') + ' ' + $('review-warning').textContent;
        if (r.notice) requestAnimationFrame(() => flash($('review-warning'), 'down'));
      }
      $('review-full').textContent = JSON.stringify(JSON.parse(json(r)), null, 2);
    } else {
      $('review-warning').textContent =
        'This shares your account address only. It does not give the site permission to sign future transactions.';
      $('review-full').textContent = JSON.stringify(pending.account, null, 2);
    }
    rows.push(
      ['Network', networkName() + ' only'],
      ['Signing account', pending.account.address],
      ['Genesis', pending.account.genesis],
    );
    pairs('review-summary', rows);
    reviewMark(pending.review?.asset?.id);
    $('expires').textContent =
      'Review expires at ' + new Date(pending.expires).toLocaleTimeString();
    syncDetails();
    guardApproval();
  }
  message('');
  approvalNote = '';
  syncViews();
}
/** A site asks the wallet to prove account control for a short session; nothing is paid. */
function renderSignInReview(review: Confirmation, signIn: NonNullable<Confirmation['signIn']>) {
  document.getElementById('review-rules')?.remove();
  const minutes = Math.max(1, Math.round((signIn.expiresAt - Date.now()) / 60_000));
  const until = new Date(signIn.expiresAt).toLocaleTimeString();
  $('review-title').textContent = 'Sign in to this site?';
  $('review-origin').textContent = review.origin;
  $('approve').textContent = 'Sign in';
  $('review-full-label').textContent = 'Technical details';
  $('review-amount').hidden = true;
  $('review-qlyph').hidden = true;
  $('review-qlyph').replaceChildren();
  $('review-warning').textContent =
    `This site asks you to sign in for ${minutes} minute${minutes === 1 ? '' : 's'}, until ${until}. ` +
    'Signing proves that you control this account. It signs no transaction and moves no funds.';
  $('review-full').textContent = JSON.stringify(
    { site: review.origin, account: review.account, ...signIn },
    null,
    2,
  );
  pairs('review-summary', [
    ['Signed in until', until],
    ['Lets the site', signIn.actions.join(', ')],
    ['Network', networkName() + ' only'],
    ['Signing account', review.account.address],
    ['Genesis', review.account.genesis],
  ]);
  $('expires').textContent = 'Review expires at ' + new Date(review.expires).toLocaleTimeString();
  reviewMark();
  syncDetails();
  guardApproval();
}
/** What the priority picker says a tip does for this review. */
function tipNote(kind: 'lot' | 'session' | 'operation') {
  $('fee-sheet').querySelector('.fee-note')!.textContent =
    kind === 'operation'
      ? 'Nodes include higher tips first. The tip is paid with the network fee.'
      : kind === 'lot'
        ? 'Miners include higher tips first. The tip is paid even if someone mints this lot before you.'
        : 'Every payment of the session carries this tip, a lost one too. Higher tips are included first.';
}
/** 1000000 → 1,000,000: the integer part of a token amount, grouped for reading. */
const groupDigits = (amount: string) =>
  amount.replace(/^\d+/, (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
/** What a review calls the account it signs with. */
const accountLabel = (kind: string) =>
  kind === 'signin'
    ? 'Signing in as'
    : kind === 'connect'
      ? 'Account'
      : kind === 'vault'
        ? 'Signing with'
        : 'Sending from';
/** The account a review signs with, by name and short address. */
const accountLine = (address: string) => `${state?.name ?? 'Your account'} · ${short(address)}`;
/** A row's value; the network fee of a review that can carry a tip is the fee sheet's button. */
function rowValue(label: string, value: string) {
  const dd = document.createElement('dd');
  if (label === 'Network fee' && tipPicker.active) dd.append(tipPicker.button());
  else dd.textContent = value;
  return dd;
}
/** A plain list of review rows, without sections. */
function reviewList(items: readonly Row[]) {
  const group = node('section', '', 'review-group');
  const list = node('dl', '', 'rows');
  for (const [k, v] of items) {
    const row = node('div', '', 'review-row' + (k === 'Max cost' ? ' review-strong' : ''));
    row.append(node('dt', k), rowValue(k, v));
    list.append(row);
  }
  group.append(list);
  return group;
}
/** The token's mark beside the review title; none for QTC or a review without a token. */
function reviewMark(asset?: string) {
  $('review-mark').replaceChildren(...(asset ? [markOf(asset)] : []));
  $('review-mark').hidden = !asset;
}
/** The expiry line and the raw payload are details: shown only when asked for in Settings. */
function syncDetails() {
  $('expires').hidden = !showDetails;
  document.querySelector<HTMLElement>('.review-technical')!.hidden = !showDetails;
}
/**
 * A site asks for one payment out of the account's quantum vault on Solana, or one wQTC redemption
 * back to QTC on Quantus; the site submits it.
 */
function renderSolanaVaultReview(review: Confirmation, vault: SolanaVaultReview) {
  const redeem = vault.kind === 'redeem';
  document.getElementById('review-rules')?.remove();
  $('review-title').textContent =
    vault.network + (redeem ? ' · Redeem wQTC' : ' · Quantum vault payment');
  $('review-origin').textContent = review.origin;
  $('approve').textContent = redeem ? 'Sign redemption' : 'Sign payment';
  $('review-full-label').textContent = 'Technical details';
  $('review-qlyph').hidden = true;
  $('review-qlyph').replaceChildren();
  const [quantity, currency] = vault.amountText.split(' ');
  $('review-amount').replaceChildren(
    node('span', groupDigits(quantity ?? vault.amount), 'review-quantity'),
    document.createTextNode(' '),
    node('span', currency ?? '', 'review-currency'),
  );
  $('review-amount').hidden = false;
  arrive($('review-amount'));
  const asset =
    vault.asset === 'SOL'
      ? 'SOL'
      : `${vault.unit === 'wQTC' ? 'wQTC' : 'SPL token'} ${vault.mint} · ${vault.decimals} decimals`;
  pairs('review-summary', [
    ...(redeem
      ? ([
          ['Redeem', vault.summary],
          ['QTC to', vault.destination + (vault.ownAccount ? ' (your account)' : '')],
        ] as Row[])
      : ([['Recipient', vault.destination]] as Row[])),
    ['From vault', vault.vault],
    ['Asset', asset],
    ...(vault.source ? ([['Source token account', vault.source]] as Row[]) : []),
    ['Amount', `${vault.amountText} (${vault.amount} base units)`],
    ['Vault nonce', vault.nonce],
    ['Current Solana slot', vault.currentSlot],
    ['Valid from slot', `${vault.issuedSlot} (${slotsFromNow(vault, vault.issuedSlot)})`],
    ['Valid until slot', `${vault.expirySlot} (${slotsFromNow(vault, vault.expirySlot)})`],
    ['Requested by', review.origin],
    ['Network', vault.network + ' only'],
    ['Program', vault.program],
    ['Signing account', review.account.address],
  ]);
  $('review-warning').textContent = redeem
    ? 'Signing lets this site burn this amount of wQTC once from your vault on ' +
      vault.network +
      ', between the slots shown, so that the same amount of QTC is released to the Quantus address shown. The site submits it; nothing is sent from this wallet.'
    : 'Signing lets this site move this amount once from your vault on ' +
      vault.network +
      ', to this recipient only, between the slots shown. The site submits it; nothing is sent from this wallet.';
  $('review-full').textContent = JSON.stringify({ site: review.origin, ...vault }, null, 2);
  $('expires').textContent = 'Review expires at ' + new Date(review.expires).toLocaleTimeString();
  reviewMark();
  syncDetails();
  guardApproval();
}
/**
 * A slot of the vault window against the current slot the wallet read, as approximate wall-clock
 * time from now: slots last about 400 ms.
 */
function slotsFromNow(vault: SolanaVaultReview, slot: string): string {
  const slots = BigInt(slot) - BigInt(vault.currentSlot);
  if (slots <= 0n) return 'now';
  const seconds = Number(slots) * (SOLANA_SLOT_MS / 1000);
  return `in about ${seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`}`;
}
function renderSessionReview(review: Confirmation, session: MintSessionReview) {
  const now = Date.now(),
    unlockDeadline = review.unlockDeadline ?? 0;
  $('review-title').textContent = reviewTitle(session);
  $('review-origin').textContent = review.origin;
  $('approve').textContent = 'Start minting';
  $('review-qlyph').hidden = true;
  $('review-qlyph').replaceChildren();
  reviewMark(session.asset.id);
  const perSignature = BigInt(session.costs.networkFee);
  tipPicker.show(session.tip ?? '0', (tip) => BigInt(session.terms.maxAttempts) * (perSignature + tip));
  tipNote('session');
  const amount = reviewAmount(session);
  $('review-amount').replaceChildren(
    ...(session.terms.maxLots > 1 ? [document.createTextNode('Up to ')] : []),
    node('span', groupDigits(amount.quantity), 'review-quantity'),
    document.createTextNode(' '),
    node('span', amount.currency, 'review-currency'),
  );
  $('review-amount').hidden = false;
  // With every detail, the network fee row (the fee sheet's button) follows the spend limit.
  const detailed = reviewRows(session, now, unlockDeadline);
  if (showDetails)
    detailed.splice(
      detailed.findIndex(([k]) => k === 'Maximum protocol spend') + 1,
      0,
      essentialRows(session, now, unlockDeadline).find(([k]) => k === 'Network fee')!,
    );
  if (showDetails)
    pairs('review-summary', [
      ...detailed,
      ['Network', networkName() + ' only'],
      ['Signing account', review.account.address],
      ['Genesis', review.account.genesis],
    ]);
  else
    $('review-summary').replaceChildren(
      reviewList([
        ...essentialRows(session, now, unlockDeadline),
        ['Account', accountLine(review.account.address)],
      ]),
    );
  // One line says how to stop; the full rules sit in their own section.
  const surfaceName = inPanel ? 'panel' : 'window';
  $('review-warning').textContent = `Keep this ${surfaceName} open while minting: closing it stops signing.`;
  document.getElementById('review-rules')?.remove();
  if (!showDetails) {
    $('review-full').textContent = JSON.stringify(session, null, 2);
    $('expires').textContent = reviewExpiry(review.expires, unlockDeadline);
    syncDetails();
    guardApproval();
    return;
  }
  const rules = node('details', '', 'review-disclosure review-section');
  rules.id = 'review-rules';
  rules.append(
    node('summary', 'How minting works'),
    node(
      'p',
      reviewWarning(session, document.documentElement.dataset.extension === 'true').replaceAll(
        'this window',
        'this ' + surfaceName,
      ),
      'review-note',
    ),
  );
  $('review-warning').after(rules);
  $('review-full').textContent = JSON.stringify(session, null, 2);
  $('expires').textContent = reviewExpiry(review.expires, unlockDeadline);
  syncDetails();
  guardApproval();
}
/** Signing time left changes every second; only that value is rewritten. */
function tickSessionReview() {
  if (pending?.kind !== 'session' || !pending.session) return;
  for (const row of $('review-summary').querySelectorAll('.review-row')) {
    const label = row.firstChild?.textContent;
    if (label === 'Signing stops')
      row.lastChild!.textContent = signingStops(pending.session, Date.now(), pending.unlockDeadline ?? 0);
    if (label === 'Time limit')
      row.lastChild!.textContent = timeLimit(pending.session, Date.now(), pending.unlockDeadline ?? 0);
  }
}
/** Progress rows shown without opening Details: anything in doubt stays visible too. */
const SESSION_PROGRESS_KEY = /^(Protocol spend|Signing stops at|Unresolved|Outstanding until)$/;
/** Activity is grouped by the local day it was sent. */
function activityDay(createdAt?: number) {
  if (!createdAt) return 'Earlier';
  const date = new Date(createdAt),
    today = new Date();
  const days = Math.round(
    (new Date(today.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86_400_000,
  );
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}
const seenActivity = new Map<string, string>();
/** The activity glyph: the asset's mark with a direction badge, or the operation's state. */
/** The token an operation moves or mints: recorded since 0.9.0; for an older mint, found by its
 * symbol in the Explore catalogue (a symbol names one token). Display only. */
function txAsset(tx: Tx): string | undefined {
  if (tx.asset && /^0x[0-9a-f]{80}$/.test(tx.asset)) return tx.asset;
  if (!isMint(tx) || !tx.symbol) return undefined;
  return catalogue?.tokens.find((t) => t.symbol === tx.symbol)?.id;
}
let catalogueForActivity = false;
/** The Quark a creation made, while the account holds it: by its recorded id, or for a creation
 * recorded before ids were, the account's only Quark created at that block. */
function createdQuark(tx: Tx): Asset | undefined {
  if (tx.label !== 'inscribe') return undefined;
  const quarks = assets.filter((a) => isQlyph(a) && BigInt(a.available) > 0n);
  if (tx.asset) return quarks.find((a) => a.id === tx.asset);
  if (tx.height === undefined) return undefined;
  const owner = state?.account?.owner;
  const made = quarks.filter((a) => a.qlyph?.height === tx.height && a.qlyph?.creator === owner);
  return made.length === 1 ? made[0] : undefined;
}
/** A created Quark as Activity draws it: the collection item it became, its own content, or the
 * collection it is a document of. */
function createdArt(quark: Asset) {
  const found = collectionItems.get(quark.id);
  if (found) return quarkArt(found.item.contentType, found.item.content, itemName(found.collection, found.item), '');
  const role = roleOf(quark);
  if (role) return node('span', role.symbol.slice(0, 4), 'quark-number');
  // Too small to read text: a picture is drawn, anything else shows its number.
  const q = quark.qlyph;
  return q?.contentType?.startsWith('image/')
    ? quarkArt(q.contentType, q.content, assetName(quark), '#' + q.number)
    : node('span', q ? '#' + q.number : 'Q', 'quark-number');
}
function activityGlyph(tx: Tx, size = '') {
  const stage = txStage(tx);
  const failed = stage === 'failed';
  const confirmed = stage === 'confirmed' || stage === 'finalized';
  const glyph = node(
    'span',
    '',
    'activity-icon' + size + (failed ? ' error' : confirmed ? ' success' : ' pending'),
  );
  // A Quark creation shows the Quark it made, with a badge for where it stands.
  const quark = createdQuark(tx);
  if (quark) {
    glyph.classList.add('with-art');
    const art = node('span', '', 'activity-art');
    art.append(createdArt(quark));
    const badge = node('span', '', 'activity-badge');
    badge.append(icon(failed ? 'close' : confirmed ? 'check' : 'clock'));
    glyph.append(art, badge);
    return glyph;
  }
  // A QTC send carries the QTC mark, a token's operation its mark, with a badge for the direction.
  const asset = tx.label === 'inscribe' ? undefined : txAsset(tx);
  const mark = transferLine(tx) && tx.symbol === 'QTC' ? 'qtc' : asset ?? null;
  if (mark) {
    glyph.classList.add('with-mark');
    const badge = node('span', '', 'activity-badge');
    const made = isMint(tx) || tx.label.startsWith('deploy');
    badge.append(icon(failed ? 'close' : made ? (confirmed ? 'check' : 'clock') : 'up'));
    glyph.append(mark === 'qtc' ? qtcMark() : markOf(mark), badge);
  } else glyph.append(icon(failed ? 'close' : transferLine(tx) ? 'up' : confirmed ? 'check' : 'clock'));
  return glyph;
}
function activityStatus(tx: Tx) {
  const stage = txStage(tx);
  if (stage === 'failed') return 'Failed';
  if (stage === 'confirmed' || stage === 'finalized') return 'Confirmed';
  if (tx.status === 'broadcast-uncertain') return 'Check status';
  const text = tx.status.replaceAll('-', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
let history: Tx[] = [];
function renderHistory(txs: Tx[]) {
  history = txs;
  let day: string | undefined;
  $('history').replaceChildren(
    ...(txs.length
      ? txs.flatMap((tx) => {
          const stage = txStage(tx);
          const failed = stage === 'failed';
          const confirmed = stage === 'confirmed' || stage === 'finalized';
          const status = activityStatus(tx);
          const e = node('button', '', 'activity-item activity-heading') as HTMLButtonElement;
          e.type = 'button';
          e.dataset.hash = tx.hash;
          const seen = seenActivity.get(tx.hash);
          if (seenActivity.size && seen === undefined) requestAnimationFrame(() => arrive(e, true));
          const info = node('span', '', 'activity-info');
          const mint = isMint(tx);
          const amount = mint ? '' : transferLine(tx);
          info.append(
            node('strong', activityTitle(tx)),
            amount
              ? node('span', 'to ' + recipientLine(tx.to), 'activity-hash')
              : (mint || createdQuark(tx)) && tx.createdAt
                ? node('span', new Date(tx.createdAt).toLocaleTimeString([], { timeStyle: 'short' }), 'activity-hash')
                : node('span', short(tx.hash), 'activity-hash mono'),
          );
          if (seen !== undefined && seen !== status)
            requestAnimationFrame(() => pop(e.querySelector('.status-chip')));
          seenActivity.set(tx.hash, status);
          const side = node('span', '', 'activity-side');
          const cost = amount ? undefined : operationCost(tx);
          if (amount) side.append(node('strong', '−' + amount, 'activity-amount'));
          else if (cost !== undefined) side.append(node('strong', '−' + roughQtc(cost), 'activity-amount'));
          side.append(
            node('span', status, 'status-chip' + (failed ? ' error' : confirmed ? ' success' : '')),
          );
          e.append(activityGlyph(tx), info, side);
          e.addEventListener('click', () => openTxSheet(tx.hash));
          const group = activityDay(tx.createdAt);
          if (group === day) return [e];
          day = group;
          return [node('h3', group, 'activity-day'), e];
        })
      : [empty('No activity yet', 'Your transfers and trades will show up here.', 'clock')]),
  );
  if (txSheet.open) paintTxSheet();
  // Older mints name only their symbol: read the catalogue once to show their token's mark.
  if (!catalogue && !catalogueForActivity && txs.some((tx) => isMint(tx) && !tx.asset && tx.symbol)) {
    catalogueForActivity = true;
    void loadCatalogue()
      .then(() => renderHistory(history))
      .catch(() => undefined);
  }
}

/* One transaction in full, in a sheet over the wallet: who, how much, where it stands on chain. */
const txSheet = $<HTMLDialogElement>('tx-sheet');
let sheetHash: string | undefined;
/** The block the transaction landed in, as the background located it (`null`: not in one yet). */
let sheetBlock: { height: number; index: number | null; blockHash: string } | null = null;
let sheetBlockRead: string | undefined;
function networkLabel() {
  return state?.network?.active === 'mainnet' || (!state?.network && MAINNET_BUILD)
    ? 'Quantus Mainnet'
    : TESTNET
      ? 'Quantus Testnet'
      : 'Quantus Devnet';
}
/** Where the transaction stands, in words: the sheet's Status line. */
function txStanding(tx: Tx): string {
  const stage = txStage(tx);
  const height = tx.height ?? sheetBlock?.height;
  if (tx.status === 'expired') return 'Expired, never included in a block';
  if (tx.status === 'cancelled-before-broadcast') return 'Cancelled before it was sent';
  if (tx.nativeSuccess === false) return 'Failed';
  if (stage === 'failed') return 'Rejected';
  if (tx.status === 'finalized') return 'Finalized';
  if (stage === 'confirmed' || stage === 'included') {
    const head = chainSamples.at(-1)?.head;
    const behind = head !== undefined && Number.isSafeInteger(height) ? head - height! : undefined;
    return 'Finalizing' + (behind !== undefined && behind > 0 ? ` · included ${behind} block${behind === 1 ? '' : 's'} ago` : '');
  }
  if (tx.status === 'signed-not-submitted') return 'Signed, not sent yet';
  if (tx.status === 'broadcast-uncertain') return 'Sent, not seen in a block yet';
  return 'Sent, waiting for a block';
}
function sheetRow(label: string, value: string, options: { mono?: boolean; copy?: string; strong?: string } = {}) {
  const row = node('div', '', 'tx-row');
  const dd = node('dd', '', options.mono ? 'mono' : '');
  if (options.strong) dd.append(node('strong', options.strong), node('span', value, 'mono tx-row-sub'));
  else dd.append(node('span', value));
  if (options.copy) dd.append(copyButton(label, options.copy));
  row.append(node('dt', label), dd);
  return row;
}
/** A small copy icon for a value shown shortened. */
function copyButton(label: string, text: string) {
  const copy = node('button', '', 'icon tx-copy') as HTMLButtonElement;
  copy.type = 'button';
  copy.setAttribute('aria-label', `Copy ${label.toLowerCase()}`);
  copy.title = 'Copy';
  copy.append(icon('copy'));
  copy.addEventListener('click', () => void task(() => copyText(copy, text), copy));
  return copy;
}
/** QTC rounded up to six decimals: an estimate reads short, never below what it is. */
function aboutQtc(planck: bigint) {
  const step = 1_000_000n;
  return formatUnits(((planck + step - 1n) / step) * step, 12) + ' QTC';
}
/** A card of rows on the transaction page. */
function txGroup(rows: HTMLElement[]) {
  const group = node('dl', '', 'tx-group');
  group.append(...rows);
  return group;
}
function paintTxSheet() {
  // A refresh can briefly list nothing: the sheet keeps its last paint until the list returns.
  const tx = history.find((t) => t.hash === sheetHash);
  if (!tx) return;
  const stage = txStage(tx);
  const failed = stage === 'failed';
  const confirmed = stage === 'confirmed' || stage === 'finalized';
  $('tx-sheet-icon').replaceChildren(activityGlyph(tx, ' large'));
  const mint = isMint(tx);
  const sent = tx.label === 'sendQtc' || tx.label === 'transfer';
  $('tx-sheet-title').textContent = sent ? 'Sent ' + (tx.symbol ?? '') : activityTitle(tx);
  // A mint's tokens arrive only if its lot is in a block, so its amount carries no sign. A creation
  // shows what it cost.
  const amount = transferLine(tx);
  const cost = operationCost(tx);
  $('tx-sheet-amount').textContent = amount
    ? mint
      ? groupDigits(amount)
      : '−' + amount
    : cost !== undefined
      ? '−' + roughQtc(cost)
      : '';
  $('tx-sheet-amount').hidden = !$('tx-sheet-amount').textContent;
  // Under the amount: what it is worth, a mint's lot, or the Quark a creation made.
  const quark = createdQuark(tx);
  const qtcOut = tx.symbol === 'QTC' && tx.amount && PLANCK.test(tx.amount) ? BigInt(tx.amount) : cost;
  const worth = qtcOut !== undefined && !mint ? usdOf(qtcOut) : undefined;
  $('tx-sheet-sub').textContent =
    mint && Number.isSafeInteger(tx.lot) ? `Lot ${tx.lot} of 1000` : worth ? '≈ ' + worth : '';
  $('tx-sheet-sub').hidden = !$('tx-sheet-sub').textContent;
  const chip = $('tx-sheet-status');
  chip.textContent = activityStatus(tx);
  chip.className = 'status-chip' + (failed ? ' error' : confirmed ? ' success' : '');
  const view = $<HTMLButtonElement>('tx-sheet-view');
  // A Quark it created, or a token it created that the account holds, opens from here.
  const tokenId = quark ? undefined : tx.label.startsWith('deploy') ? txAsset(tx) : undefined;
  const token = tokenId ? assets.find((a) => a.id === tokenId) : undefined;
  view.hidden = !quark && !token;
  if (quark) {
    const found = collectionItems.get(quark.id);
    view.textContent = 'View ' + (found ? itemName(found.collection, found.item) : assetName(quark));
    view.dataset.asset = quark.id;
  } else if (token) {
    view.textContent = 'View ' + assetName(token);
    view.dataset.asset = token.id;
  }
  // Details: where it stands, when, between whom.
  const details: HTMLElement[] = [sheetRow('Status', txStanding(tx))];
  details[0]!.dataset.tone = failed ? 'error' : confirmed ? 'ok' : 'pending';
  if (tx.createdAt)
    details.push(sheetRow('Date', new Date(tx.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })));
  if (mint && Number.isSafeInteger(tx.lot)) details.push(sheetRow('Lot', `${tx.lot} of 1000`));
  if (tx.to) {
    const to = fullAddress(tx.to);
    const own = state?.accounts?.find((a) => a.owner === tx.to || a.address === to);
    details.push(
      own
        ? sheetRow('To', short(to), { strong: own.name, copy: to })
        : sheetRow('To', short(to), { mono: true, copy: to }),
    );
  }
  const from = state?.account?.address;
  if (from) details.push(sheetRow('From', short(from), { strong: state?.name ?? 'This account', copy: from }));
  details.push(sheetRow('Network', networkLabel()));
  // Fees: what it cost, estimates rounded up.
  const fees: HTMLElement[] = [];
  if (cost !== undefined && tx.qlyphsFee) fees.push(sheetRow('Qlyphs fee', formatUnits(BigInt(tx.qlyphsFee), 12) + ' QTC'));
  if (cost !== undefined && tx.charges) fees.push(sheetRow('Native charges', formatUnits(BigInt(tx.charges), 12) + ' QTC'));
  if (tx.fee && PLANCK.test(tx.fee)) fees.push(sheetRow('Network fee', '≈ ' + aboutQtc(BigInt(tx.fee))));
  const total =
    tx.symbol === 'QTC' && tx.amount && tx.fee && PLANCK.test(tx.amount) && PLANCK.test(tx.fee)
      ? BigInt(tx.amount) + BigInt(tx.fee)
      : cost;
  if (total !== undefined && fees.length) {
    fees.push(sheetRow('Total', '≈ ' + aboutQtc(total)));
    fees.at(-1)!.classList.add('tx-row-total');
  }
  // Chain: the identifiers, for the explorer.
  const chain: HTMLElement[] = [];
  const height = tx.height ?? sheetBlock?.height;
  if (Number.isSafeInteger(height)) chain.push(sheetRow('Block', '#' + height));
  chain.push(sheetRow('Transaction ID', short(tx.hash), { mono: true, copy: tx.hash }));
  chain.at(-1)!.querySelector('dd > span')!.classList.add('tx-id');
  $('tx-sheet-rows').replaceChildren(...[details, fees, chain].filter((g) => g.length).map(txGroup));
  // An accepted operation needs no verdict; a refusal says why.
  const notes: HTMLElement[] = [];
  if (tx.verdict && tx.verdict !== 'accepted') notes.push(node('p', tx.verdict, 'activity-verdict'));
  if (feeKept(tx)) notes.push(node('p', FEE_KEPT, 'activity-verdict activity-fee-kept'));
  $('tx-sheet-notes').replaceChildren(...notes);
  $('tx-sheet-explorer').hidden = !/^0x[0-9a-f]{64}$/i.test(tx.hash) || tx.status === 'cancelled-before-broadcast';
  // Read the block once the transaction is in one, and again if it moved.
  if (Number.isSafeInteger(tx.height) && sheetBlockRead !== tx.hash + ':' + tx.height) {
    sheetBlockRead = tx.hash + ':' + tx.height;
    const hash = tx.hash;
    void call<{ height: number; index: number | null; blockHash: string } | null>('tx-detail', { hash })
      .then((block) => {
        if (sheetHash !== hash) return;
        sheetBlock = block;
        paintTxSheet();
      })
      .catch(() => undefined);
  }
}
$('tx-sheet-view').addEventListener('click', () => {
  const id = $('tx-sheet-view').dataset.asset;
  const row = $('history').querySelector<HTMLElement>(`[data-hash="${sheetHash}"]`);
  txSheet.close();
  if (id) openToken(id, row ?? $('tab-activity'));
});
function openTxSheet(hash: string) {
  if (sheetHash !== hash) {
    sheetBlock = null;
    sheetBlockRead = undefined;
  }
  sheetHash = hash;
  paintTxSheet();
  if (!history.some((t) => t.hash === hash)) return;
  if (!txSheet.open) txSheet.showModal();
  $('close-tx-sheet').focus({ preventScroll: true });
}
txSheet.addEventListener('click', (event) => {
  if (event.target === txSheet) txSheet.close();
});
txSheet.addEventListener('close', () => {
  const row = $('history').querySelector<HTMLElement>(`[data-hash="${sheetHash}"]`);
  row?.focus({ preventScroll: true });
});
$('close-tx-sheet').addEventListener('click', () => txSheet.close());
$('tx-sheet-explorer').addEventListener('click', () => {
  if (sheetHash) void task(() => openExplorer(sheetHash), $('tx-sheet-explorer'));
});
/* Sending feedback: the confirmation window turns into a live receipt, the wallet follows it. */
interface SentView {
  stage: TxStage;
  label: string;
  hash?: string;
  tx?: Tx;
  error?: string;
  amount?: string;
  to?: string;
  symbol?: string;
  decimals?: number;
}
let sent: SentView | undefined;
const chainSamples: ChainHeights[] = [];
function recordChain(chain?: ChainHeights) {
  if (!chain || !Number.isSafeInteger(chain.head)) return;
  const last = chainSamples[chainSamples.length - 1];
  if (last && chain.head < last.head) chainSamples.length = 0;
  chainSamples.push(chain);
  while (chainSamples.length > 2 && chain.at - chainSamples[0]!.at > 5 * 60_000) chainSamples.shift();
}
function finalityOf(tx?: Tx) {
  return tx ? finality(tx, chainSamples[chainSamples.length - 1], blockRate(chainSamples)) : undefined;
}
function paintSeal(element: HTMLElement, stage: TxStage, tx?: Tx) {
  paintSteps(element, stage);
  const f = stage === 'included' ? finalityOf(tx) : undefined;
  if (f) element.style.setProperty('--p', String(Math.max(8, Math.round(f.progress * 100))));
  else element.style.removeProperty('--p');
}
let awaitingSince: number | undefined;
let awaitingAmount = '';
let awaitingRequest: string | undefined;
let cancelledUntil = 0;
let trackedHash: string | undefined;
let trackerUntil = 0;
const isMint = (tx: Tx) => tx.label === 'mint' || tx.label === 'mintProgressive';
/** An operation's name in Activity: a mint names its token only, its lot and amount are in the
 * detail sheet. */
function activityTitle(tx: Tx) {
  if (isMint(tx)) return tx.symbol ? 'Mint ' + tx.symbol : 'Mint';
  if (tx.label.startsWith('deploy') && tx.symbol) return 'Create ' + tx.symbol;
  // A creation says what it made: a collection item, a collection's document or a Quark.
  const quark = createdQuark(tx);
  if (quark) {
    const found = collectionItems.get(quark.id);
    if (found) return 'Mint ' + itemName(found.collection, found.item);
    const role = roleOf(quark);
    if (role)
      return {
        mint: `Mint from ${role.symbol}`,
        deploy: `Create collection ${role.symbol}`,
        layers: `Collection art · ${role.symbol}`,
        add: `Collection list · ${role.symbol}`,
      }[role.role];
    if (quark.qlyph) return 'Create Quark #' + quark.qlyph.number;
  }
  return labels[tx.label] ?? tx.label;
}
/** Operations whose Activity line is what they cost: creations, deploys and mints. */
const COSTED = new Set(['inscribe', 'deploy', 'deployProgressive', 'deployProgressiveV2', 'mint', 'mintProgressive']);
const PLANCK = /^\d{1,30}$/;
/** What a creation, deploy or mint cost as its review showed it: the Qlyphs fee, native charges and
 * the network fee. None for a failed operation, whose charges depend on how it failed, nor for one
 * recorded before the wallet kept its charges. */
function operationCost(tx: Tx): bigint | undefined {
  if (!COSTED.has(tx.label) || txStage(tx) === 'failed') return undefined;
  if (tx.qlyphsFee === undefined && tx.charges === undefined) return undefined;
  const parts = [tx.qlyphsFee ?? '0', tx.charges ?? '0', tx.fee ?? '0'];
  return parts.every((v) => PLANCK.test(v)) ? parts.reduce((sum, v) => sum + BigInt(v), 0n) : undefined;
}
function transferLine(v: { amount?: string; symbol?: string; decimals?: number }) {
  if (!v.amount || !v.symbol) return '';
  try {
    return formatUnits(BigInt(v.amount), v.decimals ?? 12) + ' ' + v.symbol;
  } catch {
    return '';
  }
}
function fullAddress(to: string) {
  try {
    return encodeAccountId(fromHex(to, 32));
  } catch {
    return to;
  }
}
function recipientLine(to?: string) {
  if (!to) return '';
  try {
    return short(encodeAccountId(fromHex(to, 32)));
  } catch {
    return short(to);
  }
}
/** `idle` is a mint session that ended with no lot in a block: no step is lit. */
function paintSteps(element: HTMLElement, stage: TxStage | 'idle') {
  element.dataset.stage = stage;
  element.dataset.step = String(stage === 'idle' ? 0 : stageStep(stage));
}
/** How long Keys keeps a sent result on screen before handing back to the site. */
const SENT_CLOSE_MS = 900;
function paintResult(first = false) {
  if (!sent) return;
  const text = stageText(sent.stage, sent.tx, finalityOf(sent.tx));
  paintSeal($('tx-result-seal'), sent.stage, sent.tx);
  paintSteps($('tx-result-steps'), sent.stage);
  $('tx-result-title').textContent = text.title;
  const amount = transferLine(sent);
  $('tx-result-amount').textContent = amount;
  $('tx-result-amount').hidden = !amount;
  $('tx-result-to').textContent = sent.to ? 'To ' + recipientLine(sent.to) : '';
  $('tx-result-to').hidden = !sent.to;
  $('tx-result-steps').hidden = sent.stage === 'failed';
  $('tx-result-detail').textContent =
    sent.stage === 'failed' && sent.error ? sent.error : text.detail;
  $('tx-result-hash').hidden = !sent.hash;
  $('tx-result-hash').querySelector('span')!.textContent = sent.hash ? short(sent.hash) : '';
  $('tx-result-hash').title = sent.hash ? 'Copy transaction ID ' + sent.hash : '';
  $('tx-result-explorer').hidden = !sent.hash;
  $('tx-result-done').textContent = stageDone(sent.stage) || !sent.hash ? 'Done' : 'Close';
  // Nothing to decide while the key signs; the actions appear with the outcome.
  $('tx-result').querySelector<HTMLElement>('.review-actions')!.hidden = sent.stage === 'signing';
  syncViews();
  if (first) $('tx-result-title').focus({ preventScroll: true });
}
/* Mint session progress: after approval the window follows the session until its payments settle. */
/** Identifies this document to the wallet; a reloaded window gets a new one, which stops signing. */
const PAGE = crypto.randomUUID();
let minting: MintSessionView | undefined;
/** An approval was sent and its session is not shown yet: leaving the page asks to cancel it. */
let sessionStarting = false;
let shownSession: Progress | undefined;
let sessionNote = '';
let sessionTimer: ReturnType<typeof setTimeout> | undefined;
let sessionPolling = false;
let sessionInFlight = false;
let stopInFlight = false;
/**
 * The wallet's answer to a session action. Unlike `call()`, it tells the wallet's refusal from a
 * dead extension context.
 */
function sessionAnswer(action: string, params: Record<string, unknown>): Promise<SessionAnswer> {
  return Promise.resolve()
    .then(async () => browser.runtime.sendMessage(await keyed({ action, ...params })))
    .then(
      (reply): SessionAnswer => {
        const r = reply as { result?: unknown; error?: string } | undefined;
        if (typeof r?.error === 'string') return { kind: 'error', error: r.error };
        try {
          const result = r?.result as { session?: unknown } | undefined;
          return {
            kind: 'view',
            view: parseMintSessionView(action === 'approve' ? result?.session : result),
          };
        } catch (e) {
          return { kind: 'error', error: e instanceof Error ? e.message : 'Invalid answer' };
        }
      },
      (): SessionAnswer => ({ kind: 'transport' }),
    );
}
/** `sessionAnswer`, given up after UI_CALL_TIMEOUT_MS instead of waiting forever. */
function sessionCall(action: string, params: Record<string, unknown>): Promise<PollOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PollOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), UI_CALL_TIMEOUT_MS);
  });
  return Promise.race([sessionAnswer(action, params), timeout]).finally(() => clearTimeout(timer));
}
/**
 * Approves a mint session and shows it. The approval has no time bound: a slow storage write can
 * delay its answer, and the session it starts meanwhile keeps signing only while this page polls
 * it. So the window polls `session-state` once a second until an answer settles the start
 * (`afterStartPoll`): each poll renews the lease of a session that runs, and shows it at once.
 */
async function startSession(review: Confirmation) {
  if (review.session) sessionAsset = { symbol: review.session.asset.symbol, decimals: review.session.asset.decimals };
  let approval: SessionAnswer | undefined;
  sessionStarting = true;
  const answered = sessionAnswer('approve', {
    id: requestId,
    digest: review.digest,
    page: PAGE,
  }).then((answer) => {
    approval = answer;
  });
  try {
    for (;;) {
      await Promise.race([answered, new Promise((resolve) => setTimeout(resolve, UI_POLL_MS))]);
      // The approval's answer as it stood before this poll was sent.
      const answer = approval;
      if (answer?.kind === 'view') return showSession(answer.view);
      const polledAt = Date.now();
      const poll = await sessionCall('session-state', { request: requestId, page: PAGE });
      const step = afterStartPoll(answer, poll, polledAt, review.expires);
      if (step.kind === 'show') return showSession(step.view);
      if (step.kind === 'fail') throw Error(step.error);
    }
  } finally {
    sessionStarting = false;
  }
}
/** Block rate for time estimates, sampled once per answer rather than once per repaint. */
function sampleSessionChain(view: MintSessionView) {
  if (view.chain && chainSamples[chainSamples.length - 1]?.at !== view.chain.at) recordChain(view.chain);
}
function showSession(view: MintSessionView) {
  minting = view;
  sampleSessionChain(view);
  shownSession = undefined;
  sessionNote = '';
  pending = undefined;
  paintSession(true);
  if (!sessionPolling) {
    sessionPolling = true;
    scheduleSessionPoll();
  }
}
/** Polls are never paused for `busy` or a hidden window: they are what keeps signing alive. */
function scheduleSessionPoll() {
  clearTimeout(sessionTimer);
  const delay = sessionPolling && minting ? pollDelay(minting, Date.now()) : null;
  if (delay === null) {
    sessionPolling = false;
    return;
  }
  sessionTimer = setTimeout(() => {
    void pollSession();
    scheduleSessionPoll();
  }, delay);
}
function applySessionOutcome(outcome: PollOutcome) {
  if (!minting) return;
  const next = afterPoll(minting, outcome, Date.now());
  minting = next.view;
  sampleSessionChain(minting);
  if (next.note !== null) sessionNote = next.note;
  if (next.stop) {
    sessionPolling = false;
    clearTimeout(sessionTimer);
  }
  paintSession();
}
async function pollSession() {
  if (sessionInFlight || !minting || !requestId || !sessionPolling) return;
  sessionInFlight = true;
  try {
    applySessionOutcome(await sessionCall('session-state', { request: requestId, page: PAGE }));
  } finally {
    sessionInFlight = false;
  }
}
/** Rewrites only the values that changed, so a reader's place in the rows survives each poll. */
function paintRows(list: HTMLElement, rows: readonly Row[]) {
  const current = [...list.children];
  if (
    current.length !== rows.length ||
    current.some((row, i) => row.firstChild?.textContent !== rows[i]![0])
  ) {
    list.replaceChildren(
      ...rows.map(([k, v]) => {
        const row = node('div', '', 'review-row');
        row.append(node('dt', k), node('dd', v));
        return row;
      }),
    );
    return;
  }
  rows.forEach(([, v], i) => {
    const value = current[i]!.lastElementChild!;
    if (value.textContent !== v) value.textContent = v;
  });
}
/** The token a session mints, as its approved review named it; a reloaded window has only its id. */
let sessionAsset: { symbol: string; decimals: number } | undefined;
/** Payment statuses as the step they reached: signed, sent, then in a block. */
const PAYMENT_STEP: Record<string, number> = { signed: 1, uncertain: 1, sent: 2, included: 3 };
/** The token, one segment per lot, the tokens received so far and where the current payment is. */
function paintSessionToken(view: MintSessionView) {
  const mark = $('mint-session-mark');
  if (mark.dataset.asset !== view.terms.asset) {
    mark.dataset.asset = view.terms.asset;
    mark.replaceChildren(markOf(view.terms.asset));
  }
  const symbol = sessionAsset?.symbol ?? state?.mintSession?.symbol;
  const verb = view.state === 'ended' ? '' : 'Minting ';
  $('mint-session-token').textContent = symbol ? verb + symbol : verb.trim();
  const n = view.terms.maxLots,
    k = view.lots.included,
    final = view.lots.finalized;
  const lots = $('mint-session-lots');
  if (lots.childElementCount !== n)
    lots.replaceChildren(...Array.from({ length: n }, () => node('span', '')));
  [...lots.children].forEach((segment, i) => {
    const s = segment as HTMLElement;
    s.dataset.state =
      i < final ? 'final' : i < k ? 'included' : i === k && view.pending && view.state !== 'ended' ? 'pending' : '';
  });
  const received = $('mint-session-received');
  received.hidden = !sessionAsset || k === 0;
  if (sessionAsset && k > 0)
    received.textContent =
      '+' +
      groupDigits(formatUnits(BigInt(view.terms.lotAmount) * BigInt(k), sessionAsset.decimals)) +
      ' ' +
      sessionAsset.symbol +
      ' received';
  const payment = view.state === 'ended' ? null : view.pending;
  $('mint-session-payment').hidden = !payment;
  if (payment) {
    $('mint-session-lot').textContent = `Lot ${payment.lot} of 1000`;
    $('mint-session-steps').dataset.step = String(PAYMENT_STEP[payment.status] ?? 1);
  }
}
function paintSession(first = false) {
  if (!minting) return;
  const focused = document.activeElement;
  const p = progress(minting, Date.now(), { rate: blockRate(chainSamples) });
  const before = shownSession;
  shownSession = p;
  const section = $('mint-session'),
    seal = $('mint-session-seal'),
    count = $('mint-session-count'),
    stop = $('mint-session-stop'),
    done = $('mint-session-done'),
    hash = $('mint-session-hash');
  $('mint-session-title').textContent = p.title;
  count.textContent = p.count;
  paintSessionToken(minting);
  // The progress leads with what is being paid and spent and when signing stops; counts fold away.
  paintRows($('mint-session-rows'), p.rows.filter(([k]) => SESSION_PROGRESS_KEY.test(k)));
  const more = p.rows.filter(([k]) => !SESSION_PROGRESS_KEY.test(k));
  paintRows($('mint-session-more-rows'), more);
  $('mint-session-more').hidden = more.length === 0;
  $('mint-session-detail').textContent =
    sessionNote || (inPanel ? p.detail.replaceAll('this window', 'this panel') : p.detail);
  hash.hidden = !p.hash;
  hash.querySelector('span')!.textContent = p.hash ? short(p.hash) : '';
  hash.title = p.hash ? 'Copy transaction ID ' + p.hash : '';
  seal.dataset.stage = p.stage;
  // CSSOM writes are allowed by the extension's style-src; inline style attributes are not.
  if (p.ring === null) seal.style.removeProperty('--p');
  else seal.style.setProperty('--p', String(p.ring));
  stop.hidden = !p.stopVisible;
  // While stopping, Stop keeps keyboard focus but ignores clicks (aria-disabled, not disabled).
  if (p.stopBusy || stopInFlight) stop.setAttribute('aria-disabled', 'true');
  else stop.removeAttribute('aria-disabled');
  done.hidden = !p.doneVisible;
  if (first || !before || before.ended !== p.ended) syncViews();
  if (before && before.announce !== p.announce)
    $('mint-session-announce').textContent = p.announce;
  if (before && p.included > before.included) {
    pop(seal);
    flash(count, 'up');
  }
  if (first) $('mint-session-title').focus({ preventScroll: true });
  else if (before && !before.ended && p.ended)
    (focused && section.contains(focused) ? done : $('mint-session-title')).focus({
      preventScroll: true,
    });
}
$('mint-session-stop').addEventListener('click', () => {
  const stop = $('mint-session-stop');
  if (!minting || minting.state === 'ended' || stopInFlight) return;
  if (stop.getAttribute('aria-disabled') === 'true') return;
  stopInFlight = true;
  stop.setAttribute('aria-disabled', 'true');
  void sessionCall('session-stop', { session: minting.id }).then((outcome) => {
    stopInFlight = false;
    if (outcome.kind === 'error' && outcome.error !== NO_SESSION)
      message(outcome.error, true);
    applySessionOutcome(outcome);
  });
});
$('mint-session-done').addEventListener('click', leave);
function followResult(txs: Tx[]) {
  const tx = sent?.hash ? txs.find((t) => t.hash === sent!.hash) : undefined;
  if (!sent || !tx) return;
  const stage = txStage(tx);
  sent.tx = tx;
  sent.stage = stage;
  paintResult();
}
function paintTracker(txs: Tx[]) {
  if (requestId) return;
  const now = Date.now();
  const tracker = $('tx-tracker');
  // A session's lots are followed as one series, not one card per payment.
  if (state?.mintSession) {
    const text = trackerText(state.mintSession);
    $('tx-tracker-title').textContent = text.title;
    $('tx-tracker-detail').textContent = text.detail;
    paintSteps($('tx-tracker-seal'), text.stage);
    paintSteps($('tx-tracker-steps'), text.stage);
    tracker.dataset.stage = text.stage;
    delete tracker.dataset.hash;
    tracker.hidden = false;
    return;
  }
  let tx: Tx | undefined;
  if (awaitingSince) {
    tx = txs
      .filter((t) => (t.createdAt ?? 0) >= awaitingSince! - 2000)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
    if (tx) {
      awaitingSince = undefined;
      awaitingRequest = undefined;
      trackedHash = tx.hash;
      trackerUntil = 0;
    } else if (now - awaitingSince > 130_000) awaitingSince = undefined;
  }
  if (!tx && trackedHash) tx = txs.find((t) => t.hash === trackedHash);
  if (!tx && !awaitingSince) {
    tx = trackedTransaction(txs, now);
    trackedHash = tx?.hash;
    trackerUntil = 0;
  }
  const stage: TxStage | undefined = tx ? txStage(tx) : awaitingSince ? 'approval' : undefined;
  if (tx && stage && stageDone(stage)) {
    trackerUntil ||= now + 6000;
    if (now > trackerUntil) {
      trackedHash = undefined;
      trackerUntil = 0;
      tx = undefined;
    }
  }
  if (!tx && cancelledUntil) {
    if (now > cancelledUntil) cancelledUntil = 0;
    else {
      $('tx-tracker-title').textContent = awaitingAmount
        ? `Not sent: ${awaitingAmount}`
        : 'Transfer not sent';
      $('tx-tracker-detail').textContent = 'Rejected or expired · Nothing was sent';
      paintSteps($('tx-tracker-seal'), 'failed');
      paintSteps($('tx-tracker-steps'), 'failed');
      tracker.dataset.stage = 'failed';
      delete tracker.dataset.hash;
      tracker.hidden = false;
      return;
    }
  }
  if (!stage || (!tx && stage !== 'approval')) {
    tracker.hidden = true;
    delete tracker.dataset.hash;
    return;
  }
  const text = stageText(stage, tx, finalityOf(tx));
  const amount = tx ? transferLine(tx) : awaitingAmount;
  const verb =
    stage === 'finalized' || stage === 'confirmed' || stage === 'included'
      ? 'Sent'
      : stage === 'failed'
        ? 'Not sent:'
        : stage === 'approval'
          ? 'Confirm'
          : 'Sending';
  $('tx-tracker-title').textContent =
    amount && stage !== 'failed'
      ? `${verb} ${amount}`
      : tx
        ? tx.label === 'inscribe'
          ? activityTitle(tx)
          : (labels[tx.label] ?? text.title)
        : text.title;
  $('tx-tracker-detail').textContent =
    stage === 'failed' ? text.title + ' · ' + text.detail : text.detail;
  paintSeal($('tx-tracker-seal'), stage, tx);
  paintSteps($('tx-tracker-steps'), stage);
  tracker.dataset.stage = stage;
  if (tx) tracker.dataset.hash = tx.hash;
  else delete tracker.dataset.hash;
  tracker.hidden = false;
}
// While something is in flight, follow it closely; the background journal stays the source of truth.
setInterval(() => {
  if (busy || document.hidden || pendingBalanceRequests) return;
  if (requestId) {
    // Confirmation completes the visible receipt, but keep observing its actual chain status.
    if (sent?.hash && sent.stage !== 'finalized' && sent.stage !== 'failed') {
      pendingBalanceRequests++;
      void call<BalanceView>('balances')
        .then((v) => {
          recordChain(v.chain);
          followResult(v.transactions);
        })
        .catch(() => undefined)
        .finally(() => pendingBalanceRequests--);
    }
    return;
  }
  if (awaitingSince && awaitingRequest)
    void call<{ state: string }>('request-state', { id: awaitingRequest })
      .then((r) => {
        if (r.state !== 'closed' || !awaitingSince) return;
        // Give a just-approved transfer one refresh to appear before calling it cancelled.
        return balances(true).then(() => {
          if (!awaitingSince) return;
          awaitingSince = undefined;
          awaitingRequest = undefined;
          cancelledUntil = Date.now() + 5000;
          paintTracker(balanceView?.transactions ?? []);
        });
      })
      .catch(() => undefined);
  refreshBalances();
}, 4000);
function refreshBalances(force = false) {
  if (busy || document.hidden || requestId || !state?.account || pendingBalanceRequests) return;
  const settling =
    !$('tx-tracker').hidden || (balanceView && incomingBalance(balanceView.balance) > 0n);
  // Discover deposits even when nothing is pending, and never supersede a slow refresh on each tick.
  if (force || settling || Date.now() - lastBalanceRefresh >= 15_000)
    void balances(true).catch(() => undefined);
}
window.addEventListener('focus', () => refreshBalances(true));
document.addEventListener('visibilitychange', () => refreshBalances(true));
const assetAmounts = new Map<string, string>();
/** Logos come from the background, already checked and turned into data: URLs. */
const logoRequests = new Map<string, Promise<string | null>>();
function logo(asset: string) {
  let request = logoRequests.get(asset);
  if (!request) {
    request = call<string | null>('token-logo', { asset }).then(
      (value) => {
        // A token's logo is served once its creation is final: no logo yet is asked again later.
        if (!value) setTimeout(() => logoRequests.delete(asset), 60_000);
        return value;
      },
      () => {
        // Not cached: the next view asks again.
        logoRequests.delete(asset);
        return null;
      },
    );
    logoRequests.set(asset, request);
  }
  return request;
}
const markOf = (id?: string) => (id ? tokenMark(id, logo) : qtcMark());
/** Token profiles from the background, already checked (platform.ts): text and safe links only. */
const profileViews = new Map<string, TokenProfile | null>();
const profileRequests = new Set<string>();
function loadProfile(asset: string) {
  if (profileViews.has(asset) || profileRequests.has(asset)) return;
  profileRequests.add(asset);
  void call<TokenProfile | null>('token-profile', { asset })
    .then(
      (value) => {
        profileViews.set(asset, value);
        // No profile yet may be added later: ask again on a later view.
        if (!value) setTimeout(() => profileViews.delete(asset), 60_000);
        if (shownToken === asset) paintAbout(asset);
      },
      () => undefined,
    )
    .finally(() => profileRequests.delete(asset));
}
/** Where each profile link goes: the creator's https website, or the handle on X or Telegram. */
function profileLinks(p: TokenProfile): [label: string, url: string, icon: string][] {
  const links: [string, string, string][] = [];
  if (p.website) links.push([new URL(p.website).host.replace(/^www\./, ''), p.website, 'i-expand']);
  if (p.x) links.push(['@' + p.x + ' on X', 'https://x.com/' + p.x, 'i-expand']);
  if (p.telegram) links.push(['@' + p.telegram + ' on Telegram', 'https://t.me/' + p.telegram, 'i-expand']);
  return links;
}
function paintAbout(id: string) {
  const p = id === 'qtc' ? null : (profileViews.get(id) ?? null);
  $('token-about').hidden = !p;
  $('token-description').textContent = p?.description ?? '';
  $('token-links').replaceChildren(
    ...(p ? profileLinks(p) : []).map(([label, url]) => {
      const b = node('button', '', 'secondary');
      b.setAttribute('type', 'button');
      b.title = url;
      b.append(node('span', label));
      b.insertAdjacentHTML('beforeend', '<svg aria-hidden="true"><use href="#i-expand" /></svg>');
      b.addEventListener('click', () => void browser.tabs.create({ url }));
      return b;
    }),
  );
}
function assetRow(
  symbol: string,
  title: string,
  amount: string,
  id?: string,
  exactAmount = amount,
  value?: string,
  change?: { text: string; tone: string },
) {
  const e = node('button', '', 'asset-row') as HTMLButtonElement;
  e.type = 'button';
  const info = node('span', '', 'asset-info');
  info.append(
    node('strong', id ? symbol : 'Quantus'),
    node('small', privateBalances ? '•••• ' + symbol : amount + ' ' + symbol),
  );
  info.lastElementChild!.classList.add('asset-amount');
  const side = node('span', '', 'asset-side');
  if (value && !privateBalances) side.append(node('span', value, 'asset-value'));
  if (change && value && !privateBalances) {
    const line = node('small', change.text, 'asset-change');
    line.dataset.tone = change.tone;
    side.append(line);
  }
  if (title) side.append(node('small', title, 'asset-note'));
  e.title = id ?? '';
  const quantity = info.lastElementChild as HTMLElement;
  const key = id ?? 'qtc',
    previous = assetAmounts.get(key);
  assetAmounts.set(key, exactAmount);
  if (previous !== undefined && previous !== exactAmount && !privateBalances)
    requestAnimationFrame(() =>
      flash(quantity, Number(exactAmount) > Number(previous) ? 'up' : 'down'),
    );
  if (!privateBalances) quantity.title = exactAmount + ' ' + symbol;
  e.append(markOf(id), info, side);
  e.setAttribute('aria-label', (id ? symbol : 'Quantus') + ', ' + (privateBalances ? 'balance hidden' : amount + ' ' + symbol));
  e.addEventListener('click', () => openToken(id ?? 'qtc', e));
  return e;
}
/** A Quark as a tile: its content through the safe renderer, or its number when unread. */
/** A Quark's content through the safe renderer, or its number when it cannot be shown. */
function quarkArt(contentType: string | undefined, content: string | undefined, label: string, fallback: string) {
  if (contentType && content)
    try {
      return renderQlyph(document, contentType, content, label);
    } catch {
      // Falls through to the number.
    }
  return node('span', fallback, 'quark-number');
}
/** What a held Quark that is not a collection item is to a collection, from its own content: a
 * mint not counted yet (not final, or refused by the rules), or a creator's deploy, list or art. */
function roleOf(asset: Asset): CollectionRole | null {
  const q = asset.qlyph;
  return q?.contentType && q.content ? collectionRole(q.contentType, q.content) : null;
}
const ROLE_LABEL: Record<CollectionRole['role'], [string, string]> = {
  mint: ['mint', 'mint · not counted yet'],
  deploy: ['deploy', 'collection deploy'],
  add: ['list', 'collection list'],
  layers: ['art', 'collection art'],
};
function quarkTile(asset: Asset) {
  const name = assetName(asset);
  const tile = node('button', '', 'quark-tile') as HTMLButtonElement;
  tile.type = 'button';
  const art = node('span', '', 'quark-art');
  const q = asset.qlyph;
  const role = roleOf(asset);
  if (role) {
    // A document, not a picture: its symbol and role say what it is to the collection.
    const doc = node('span', '', 'quark-doc');
    doc.append(node('span', role.symbol, 'quark-number'), node('small', ROLE_LABEL[role.role][1]));
    art.append(doc);
  } else art.append(quarkArt(q?.contentType, q?.content, name, q ? '#' + q.number : 'Q'));
  const label = node('span', '', 'quark-label');
  label.append(node('strong', name), node('small', '1 of 1'));
  tile.setAttribute(
    'aria-label',
    role ? `${name}, ${role.symbol} ${ROLE_LABEL[role.role][1]}` : name + ', 1 of 1',
  );
  tile.append(art, label);
  tile.title = asset.id;
  tile.addEventListener('click', () => openToken(asset.id, tile));
  return tile;
}

/* Collections: the account's Quarks that belong to a collection, named, numbered and drawn by the
 * Qlyphs app. The indexer's list of held Quarks stays the source: the app is asked about those only,
 * and an item whose Quark left the account disappears with it. */
let holdings: (Holdings & { owner: string }) | undefined;
/** The last read failed and nothing is known yet: the tab says so instead of "none". */
let holdingsFailed = false;
const collectionItems = new Map<string, { collection: HeldCollection; item: CollectionItem }>();
let holdingsRequest = 0;
const heldQuarks = () => assets.filter((a) => isQlyph(a) && BigInt(a.available) > 0n);
async function loadCollections() {
  const owner = state?.account?.owner;
  if (!owner || !state?.unlocked) return;
  const request = ++holdingsRequest;
  try {
    const answer = await call<Holdings>('collections', { quarks: heldQuarks().map((a) => a.id).slice(0, 1000) });
    if (request !== holdingsRequest || state?.account?.owner !== owner) return;
    holdings = { ...answer, owner };
    holdingsFailed = false;
  } catch {
    // Unavailable for now: the Quarks stay listed as Quarks, and the next refresh asks again.
    if (request !== holdingsRequest || holdings?.owner === owner) return;
    holdings = undefined;
    holdingsFailed = true;
  }
  paintHoldings();
}
/** A collection on Collectibles: the items the account holds, and the Quarks it holds that are
 * the collection's documents (a deploy, art, a list) or its mints not counted yet. */
interface Group extends HeldCollection {
  /** Listed by the Qlyphs app; false when only known from the account's own documents. */
  listed: boolean;
  docs: { asset: Asset; role: CollectionRole }[];
}
const groupsBySymbol = new Map<string, Group>();
function paintHoldings() {
  const quarks = heldQuarks();
  const held = new Set(quarks.map((a) => a.id));
  collectionItems.clear();
  groupsBySymbol.clear();
  const known = holdings && holdings.owner === state?.account?.owner ? holdings : undefined;
  for (const collection of known?.collections ?? []) {
    // Items in collection order.
    const items = collection.items.filter((i) => held.has(i.id)).sort((a, b) => a.edition - b.edition);
    if (!items.length && !collection.created) continue;
    const group: Group = { ...collection, items, listed: true, docs: [] };
    groupsBySymbol.set(collection.symbol, group);
    for (const item of items) collectionItems.set(item.id, { collection: group, item });
  }
  // Once collections are read (or cannot be), a collection's documents and uncounted mints join it
  // instead of standing among the Quarks.
  const settled = !!known || holdingsFailed;
  const loose: Asset[] = [];
  for (const asset of quarks) {
    if (collectionItems.has(asset.id)) continue;
    const role = settled ? roleOf(asset) : null;
    if (!role) {
      loose.push(asset);
      continue;
    }
    let group = groupsBySymbol.get(role.symbol);
    if (!group) {
      group = {
        symbol: role.symbol,
        name: role.symbol,
        supply: null,
        minted: 0,
        created: false,
        cover: null,
        items: [],
        listed: false,
        docs: [],
      };
      groupsBySymbol.set(role.symbol, group);
    }
    if (role.role === 'deploy') group.created = true;
    group.docs.push({ asset, role });
  }
  // The sets the account holds most of first, then its own.
  const groups = [...groupsBySymbol.values()].sort(
    (a, b) =>
      b.items.length - a.items.length || Number(b.created) - Number(a.created) || a.name.localeCompare(b.name),
  );
  $('collectible-count').textContent = String(quarks.length);
  $('collection-count').textContent = String(groups.length);
  $('quark-count').textContent = String(loose.length);
  const loading = !settled && quarks.length > 0;
  $('collections-block').hidden = !groups.length && !loading && !(known && !known.open && quarks.length);
  $('collections').replaceChildren(
    ...(loading
      ? [node('div', '', 'skeleton collection-skeleton'), node('div', '', 'skeleton collection-skeleton')]
      : groups.map(collectionCard)),
    ...(holdingsFailed && !known
      ? [node('p', 'Collections unavailable · Check your connection, then refresh.', 'field-hint')]
      : known && !known.open && quarks.length
        ? [node('p', 'Collections are not open on this network yet.', 'field-hint')]
        : known?.more
          ? [node('p', 'More of your items are on Qlyphs.', 'field-hint')]
          : []),
  );
  $('quarks-block').hidden = !loose.length;
  $('quarks').replaceChildren(...loose.map(quarkTile));
  $('collectibles-empty').replaceChildren(...(quarks.length ? [] : [noCollectibles(known?.open !== false)]));
  // The send form names an item as the collection does, still with its Quark's id.
  for (const option of $<HTMLSelectElement>('send-asset').options) {
    const found = collectionItems.get(option.value);
    if (found) option.textContent = itemName(found.collection, found.item) + ' · ' + short(option.value);
  }
  if ($<HTMLDetailsElement>('send-panel').open) sendAssetDetails();
  if ($<HTMLDetailsElement>('collection-panel').open) paintCollection();
  if ($('token-panel').hasAttribute('open')) paintToken();
  // Activity names a creation by the collection item it became.
  if (history.length) renderHistory(history);
}
const itemName = (collection: HeldCollection, item: CollectionItem) => `${collection.name} #${item.edition}`;
/** An asset as this wallet names it: a collection item by its collection and number. */
function ownName(asset: Asset) {
  const found = collectionItems.get(asset.id);
  return found ? itemName(found.collection, found.item) : assetName(asset);
}
function noCollectibles(open: boolean) {
  const box = empty(
    'No collectibles yet',
    open
      ? 'Quarks and collection items you create, mint or receive appear here.'
      : 'Quarks you create or receive appear here.',
    'grid',
  );
  if (open) {
    const explore = node('button', 'Explore collections on Qlyphs ', 'secondary') as HTMLButtonElement;
    explore.type = 'button';
    explore.append(icon('expand'));
    explore.addEventListener('click', () => void task(() => openPage({ kind: 'collections' }), explore));
    box.append(explore);
  }
  return box;
}
const itemCount = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;
/** What a collection's card says under its name: what the account holds of it, or why it is there. */
function groupNote(group: Group) {
  if (group.items.length === 1 && !group.created) return '#' + group.items[0]!.edition;
  if (group.items.length) return itemCount(group.items.length);
  if (group.created) return 'Created by you';
  const pending = group.docs.filter((d) => d.role.role === 'mint').length;
  return pending ? `${pending} not counted yet` : 'Collection Quarks';
}
/** The picture of a collection: its first item, else the cover the app draws, else its symbol. */
function groupArt(group: Group) {
  const first = group.items[0];
  if (first) return quarkArt(first.contentType, first.content, itemName(group, first), '#' + first.edition);
  if (group.cover) return quarkArt(group.cover.contentType, group.cover.content, group.name, group.symbol);
  return node('span', group.symbol, 'quark-number');
}
/** A collection card: four items or more as a mosaic, else one picture; its name and note. A single
 * item, with nothing else of the collection held, opens that item; any other card the collection. */
function collectionCard(group: Group) {
  const items = group.items;
  const card = node('button', '', 'collection-card') as HTMLButtonElement;
  card.type = 'button';
  const cover = node('span', '', 'collection-cover');
  if (items.length >= 4) {
    cover.dataset.mosaic = '';
    for (const item of items.slice(0, 4)) {
      const cell = node('span', '', 'cell');
      cell.append(quarkArt(item.contentType, item.content, itemName(group, item), '#' + item.edition));
      cover.append(cell);
    }
  } else {
    const cell = node('span', '', 'cell');
    cell.append(groupArt(group));
    cover.append(cell);
  }
  const note = groupNote(group);
  const label = node('span', '', 'quark-label');
  label.append(node('strong', group.name), node('small', note));
  card.append(cover, label);
  card.title = group.symbol;
  const single = items.length === 1 && !group.created && !group.docs.length;
  card.setAttribute('aria-label', single ? itemName(group, items[0]!) : `${group.name}, ${note}`);
  card.addEventListener('click', () =>
    single ? openToken(items[0]!.id, card) : openCollection(group.symbol, card),
  );
  return card;
}
/* Collection: the account's items of one collection by number, then its other Quarks of it. */
let shownCollection: string | undefined;
function openCollection(symbol: string, trigger: HTMLElement) {
  shownCollection = symbol;
  paintCollection();
  openPanel('collection-panel', trigger);
}
const DOC_ORDER: CollectionRole['role'][] = ['deploy', 'layers', 'add', 'mint'];
const DOC_LABEL: Record<CollectionRole['role'], string> = {
  deploy: 'Deploy',
  layers: 'Art',
  add: 'Item list',
  mint: 'Mint · not counted yet',
};
function paintCollection() {
  const group = shownCollection ? groupsBySymbol.get(shownCollection) : undefined;
  if (!group) {
    // Nothing of it is left in the account: nothing to show any more.
    if ($<HTMLDetailsElement>('collection-panel').open) closePanel('collection-panel');
    return;
  }
  const items = group.items;
  $('collection-title').textContent = group.name;
  $('collection-cover').replaceChildren(groupArt(group));
  $('collection-held').textContent = items.length
    ? group.supply
      ? `You hold ${items.length} of ${group.supply}`
      : `You hold ${itemCount(items.length)}`
    : group.created
      ? 'Created by you'
      : 'No item yet';
  $('collection-meta').textContent = (
    group.listed
      ? [
          group.name === group.symbol ? '' : group.symbol,
          group.supply ? `${group.minted} minted` : `${group.minted} minted · Open edition`,
          items.length && group.created ? 'Created by you' : '',
        ]
      : [group.symbol, 'Not listed on Qlyphs yet']
  )
    .filter(Boolean)
    .join(' · ');
  $('collection-items').hidden = !items.length;
  $('collection-items').replaceChildren(...items.map((item) => itemTile(group, item)));
  const docs = [...group.docs].sort(
    (a, b) =>
      DOC_ORDER.indexOf(a.role.role) - DOC_ORDER.indexOf(b.role.role) ||
      (a.asset.qlyph?.number ?? 0) - (b.asset.qlyph?.number ?? 0),
  );
  $('collection-docs-block').hidden = !docs.length;
  $('collection-docs').replaceChildren(...docs.map(docRow));
  $('collection-more').hidden = !holdings?.more || !items.length;
  // A creator without items yet mints from the collection's page.
  $('collection-open').firstChild!.textContent =
    group.created && !items.length ? 'Mint on Qlyphs ' : 'View collection on Qlyphs ';
}
function docRow({ asset, role }: { asset: Asset; role: CollectionRole }) {
  const row = node('button', '', 'asset-row doc-row') as HTMLButtonElement;
  row.type = 'button';
  const mark = node('span', { deploy: 'D', layers: 'A', add: 'L', mint: '…' }[role.role], 'doc-mark');
  mark.setAttribute('aria-hidden', 'true');
  const info = node('span', '', 'asset-info');
  info.append(node('strong', DOC_LABEL[role.role]), node('small', assetName(asset)));
  row.append(mark, info);
  row.title = asset.id;
  row.setAttribute('aria-label', `${DOC_LABEL[role.role]}, ${assetName(asset)}`);
  row.addEventListener('click', () => openToken(asset.id, row));
  return row;
}
function itemTile(collection: HeldCollection, item: CollectionItem) {
  const tile = node('button', '', 'item-tile') as HTMLButtonElement;
  tile.type = 'button';
  const art = node('span', '', 'item-art');
  art.append(quarkArt(item.contentType, item.content, itemName(collection, item), '#' + item.edition));
  const label = node('span', '', 'item-label');
  label.append(node('strong', '#' + item.edition), ...(item.rank ? [node('small', 'Rank ' + item.rank)] : []));
  tile.append(art, label);
  tile.title = item.id;
  tile.setAttribute('aria-label', itemName(collection, item) + (item.rank ? `, rarity rank ${item.rank}` : ''));
  tile.addEventListener('click', () => openToken(item.id, tile));
  return tile;
}
/** A token's value in QTC from its last completed sale, when it has one. Display only. */
/** What a token balance is worth in QTC (planck): at the price its page last showed, else at its
 * last sale. */
function qtcValueOf(asset: Asset): bigint {
  const price = marketPrices.get(asset.id);
  const sale = catalogue?.tokens.find((t) => t.id === asset.id)?.lastSale;
  return price !== undefined
    ? (BigInt(asset.available) * price) / 10n ** BigInt(asset.definition.decimals)
    : sale
      ? (BigInt(asset.available) * BigInt(sale.price)) / BigInt(sale.amount)
      : 0n;
}
/** A token balance's value: in dollars when the QTC price is known, else in QTC. */
function valueOf(asset: Asset): string | undefined {
  const value = qtcValueOf(asset);
  return value > 0n ? (usdOf(value) ?? '≈ ' + formatBalance(value, 12) + ' QTC') : undefined;
}
/** A balance worth `now` QTC (planck), and `then` 24 hours ago at the same holdings, in dollars:
 * its value and its change, as wallets list holdings. The change also follows QTC's own price. */
function dollarLine(now: bigint, then?: bigint) {
  if (!showPrices || !qtcUsd || now <= 0n) return undefined;
  const usd = qtcUsd.usd;
  const value = (Number(now) / 1e12) * usd;
  if (then === undefined) return { value: formatUsdValue(value) };
  const before = (Number(then) / 1e12) * (qtcUsd.change === null ? usd : usd / (1 + qtcUsd.change / 100));
  const change = value - before;
  return {
    value: formatUsdValue(value),
    change: formatUsdChange(change),
    tone: Math.abs(change) < 0.005 ? 'flat' : change > 0 ? 'up' : 'down',
  };
}
/** The account's total in dollars now and 24 hours ago: its QTC and every token with a price,
 * at the same holdings. None without the QTC price. */
function totalDollars(free: bigint, tokens: Asset[]) {
  if (!showPrices || !qtcUsd) return undefined;
  const usd = qtcUsd.usd,
    usdThen = qtcUsd.change === null ? usd : usd / (1 + qtcUsd.change / 100);
  let now = Number(free) / 1e12,
    then = now;
  for (const a of tokens) {
    const value = qtcValueOf(a);
    if (value <= 0n) continue;
    const trades = heldTrades.get(a.id);
    const day = trades?.length ? marketView(trades, a.definition.decimals, '1D', Date.now()) : null;
    const before = day ? (BigInt(a.available) * day.points[0]!.price) / 10n ** BigInt(a.definition.decimals) : value;
    now += Number(value) / 1e12;
    then += Number(before) / 1e12;
  }
  return { now: now * usd, then: then * usdThen };
}
/** A held token's line: its value now and 24 hours ago, from its trades once read. */
function tokenDollars(asset: Asset) {
  const now = qtcValueOf(asset);
  const trades = heldTrades.get(asset.id);
  if (!trades?.length) return dollarLine(now);
  const day = marketView(trades, asset.definition.decimals, '1D', Date.now());
  const then = day ? (BigInt(asset.available) * day.points[0]!.price) / 10n ** BigInt(asset.definition.decimals) : undefined;
  return dollarLine(now, then);
}
/** Trades of the tokens the account holds (at most 12), for their price and 24 h change. */
const heldTrades = new Map<string, Trade[]>();
let heldTradesAt = 0;
async function loadHeldTrades(tokens: Asset[]) {
  if (Date.now() - heldTradesAt < 30_000) return;
  heldTradesAt = Date.now();
  let changed = false;
  await Promise.all(
    tokens.slice(0, 12).map(async (a) => {
      try {
        const trades = await call<Trade[]>('token-market', { asset: a.id });
        heldTrades.set(a.id, trades);
        if (trades.length) {
          marketPrices.set(a.id, unitPrice(trades[0]!, a.definition.decimals));
          changed = true;
        }
      } catch {
        // That token keeps its last-sale value.
      }
    }),
  );
  if (changed) paintBalances();
}
/* The QTC price in dollars, from CoinGecko through the background, unless turned off in Settings.
 * Dollar values of balances show on mainnet only: test QTC have no value. */
const PRICES_KEY = 'qlyphs.showPrices';
let showPrices = (() => {
  try {
    return localStorage.getItem(PRICES_KEY) !== '0';
  } catch {
    return true;
  }
})();
let qtcUsd: QtcPrice | undefined;
const qtcCharts = new Map<UsdRange, { at: number; points: [number, number][] }>();
let qtcRange: UsdRange = '1D';
const onMainnet = () => state?.network?.active === 'mainnet' || (!state?.network && MAINNET_BUILD);
/** A QTC amount (planck) in dollars, when the price is known. On a test network it is the mainnet
 * price: the QTC page says test QTC have no value. */
function usdOf(planck: bigint): string | undefined {
  if (!showPrices || !qtcUsd) return undefined;
  return formatUsdValue((Number(planck) / 1e12) * qtcUsd.usd);
}
async function loadQtcPrice() {
  if (!showPrices) return;
  try {
    const price = await call<QtcPrice>('qtc-price');
    if (!showPrices) return;
    const changed = price.usd !== qtcUsd?.usd || price.change !== qtcUsd?.change;
    qtcUsd = price;
    if (!changed) return;
    paintBalances();
    if ($<HTMLDetailsElement>('token-panel').open) paintToken();
  } catch {
    // No dollar values; QTC amounts stand alone.
  }
}
async function loadQtcChart(range: UsdRange) {
  const known = qtcCharts.get(range);
  if (!showPrices || (known && Date.now() - known.at < 5 * 60_000)) return;
  try {
    const points = await call<[number, number][]>('qtc-chart', { range });
    qtcCharts.set(range, { at: Date.now(), points });
    if (shownToken === 'qtc' && $<HTMLDetailsElement>('token-panel').open) paintToken();
  } catch {
    // The price shows without its chart.
  }
}
/* A token's price on its page: the latest trade on Qlyphs, its change over a period and a chart,
 * read when the page opens. */
let market: { asset: string; trades: Trade[] } | undefined;
let marketRange: Range | undefined;
/** The latest price each token page showed, planck per whole token. */
const marketPrices = new Map<string, bigint>();
async function loadMarket(id: string) {
  if (market?.asset !== id) {
    market = undefined;
    marketRange = undefined;
  }
  try {
    const trades = await call<Trade[]>('token-market', { asset: id });
    if (shownToken !== id) return;
    market = { asset: id, trades };
    paintToken();
  } catch {
    // No price is shown; the page works without it.
  }
}
/** Period buttons for the chart: a token's trades (with All) or the QTC market (with 1Y). */
function marketRanges(kind: 'token' | 'qtc', selected: string) {
  const ranges = $('token-ranges');
  const names: Record<string, string> = { '1D': 'One day', '1W': 'One week', '1M': 'One month', '1Y': 'One year', All: 'All trades' };
  if (ranges.dataset.kind !== kind) {
    ranges.dataset.kind = kind;
    ranges.replaceChildren(
      ...(kind === 'qtc' ? USD_RANGES : RANGES).map(([r]) => {
        const button = node('button', r, 'pill market-range') as HTMLButtonElement;
        button.type = 'button';
        button.dataset.range = r;
        button.setAttribute('aria-label', names[r]!);
        button.addEventListener('click', () => {
          if (ranges.dataset.kind === 'qtc') {
            qtcRange = r as UsdRange;
            void loadQtcChart(qtcRange);
          } else marketRange = r as Range;
          paintMarket();
        });
        return button;
      }),
    );
  }
  for (const button of ranges.querySelectorAll<HTMLElement>('button'))
    button.setAttribute('aria-pressed', String(button.dataset.range === selected));
}
function drawMarket(view: {
  price: string;
  usd: string;
  change: number | null;
  label: string;
  points: { time: number; price: bigint | number }[];
  step: boolean;
  note: string;
}) {
  const section = $('token-market');
  section.hidden = false;
  $('token-price').textContent = view.price;
  $('token-price-usd').textContent = view.usd;
  $('token-change').textContent =
    view.change === null ? '' : `${view.change < 0 ? '−' : '+'}${Math.abs(view.change).toFixed(2)}% · ${view.label}`;
  section.dataset.trend = !view.change ? 'flat' : view.change > 0 ? 'up' : 'down';
  const { line, area } = view.points.length > 1 ? chartPaths(view.points, 320, 88, view.step) : { line: '', area: '' };
  $('token-chart').querySelector('.market-line')!.setAttribute('d', line);
  $('token-chart').querySelector('.market-area')!.setAttribute('d', area);
  $('token-market-note').textContent = view.note;
}
/** QTC: its market price in dollars, its change and chart over the chosen period. */
function paintQtcMarket() {
  const chart = qtcCharts.get(qtcRange)?.points;
  const usd = qtcUsd?.usd ?? chart?.at(-1)?.[1];
  if (!showPrices || usd === undefined) {
    $('token-market').hidden = true;
    return;
  }
  const first = chart?.[0]?.[1];
  const change =
    qtcRange === '1D' && qtcUsd?.change != null
      ? qtcUsd.change
      : first && chart!.length > 1
        ? ((chart!.at(-1)![1] - first) / first) * 100
        : null;
  drawMarket({
    price: formatUsd(usd),
    usd: '',
    change,
    label: qtcRange,
    points: (chart ?? []).map(([time, price]) => ({ time, price })),
    step: false,
    note: onMainnet()
      ? 'Market price from CoinGecko.'
      : 'Market price of QTC on mainnet, from CoinGecko. Test QTC have no value.',
  });
  marketRanges('qtc', qtcRange);
}
function paintMarket() {
  const id = shownToken;
  if (id === 'qtc') return paintQtcMarket();
  const section = $('token-market');
  const decimals =
    assets.find((a) => a.id === id)?.definition.decimals ?? catalogue?.tokens.find((t) => t.id === id)?.decimals;
  const now = Date.now();
  const view =
    market?.asset === id && decimals !== undefined
      ? marketView(market.trades, decimals, (marketRange ??= defaultRange(market.trades, now)), now)
      : null;
  section.hidden = !view;
  if (!view) return;
  const range = marketRange!;
  marketPrices.set(id, view.price);
  drawMarket({
    price: formatPrice(view.price),
    usd: showPrices && qtcUsd ? '≈ ' + formatUsd((Number(view.price) / 1e12) * qtcUsd.usd) : '',
    change: view.change,
    label: range === 'All' ? 'all trades' : range,
    points: view.points,
    step: true,
    note: 'From the latest sales and mints on Qlyphs.',
  });
  marketRanges('token', range);
}
async function openPage(page: PlatformPage) {
  await browser.tabs.create({ url: platformURL(PLATFORM, page) });
}
/** `click` for handlers bound before it is declared further down. */
const onClick = (id: string, fn: () => Promise<void>) =>
  $(id).addEventListener('click', () => void task(fn, $(id)));

/* Token detail: balance, Send and Receive, and the token's page on Qlyphs. */
let shownToken = 'qtc';
function openToken(id: string, trigger: HTMLElement) {
  shownToken = id;
  paintToken();
  openPanel('token-panel', trigger);
  const asset = assets.find((a) => a.id === id);
  if (id === 'qtc') {
    void loadQtcPrice();
    void loadQtcChart(qtcRange);
  } else if (!isQlyph(asset)) {
    void loadMarket(id);
    loadProfile(id);
  }
}
function paintToken() {
  const id = shownToken;
  const native = id === 'qtc';
  const asset = native ? undefined : assets.find((a) => a.id === id);
  const quark = isQlyph(asset);
  const entry = quark ? collectionItems.get(id) : undefined;
  const name = entry
    ? itemName(entry.collection, entry.item)
    : native
      ? 'Quantus'
      : asset
        ? assetName(asset)
        : 'Unavailable asset';
  const symbol = native ? 'QTC' : asset ? ownName(asset) : '';
  $('token-title').textContent = name;
  paintAbout(quark ? 'qtc' : id);
  const mark = $('token-mark');
  const art = entry ? entry.item : asset?.qlyph;
  if (quark && art?.contentType && art.content) {
    try {
      mark.replaceChildren(renderQlyph(document, art.contentType, art.content, name));
    } catch {
      mark.replaceChildren(markOf(id));
    }
  } else mark.replaceChildren(native ? qtcMark() : markOf(id));
  mark.dataset.kind = entry ? 'item' : quark ? 'quark' : 'token';
  const available = native ? (balanceView ? BigInt(balanceView.balance.free) : undefined) : asset ? BigInt(asset.available) : undefined;
  const decimals = native ? 12 : (asset?.definition.decimals ?? 0);
  // A Quark stands alone (1 of 1); a collection item is one numbered piece of a set.
  $('token-balance').textContent = entry
    ? entry.collection.supply
      ? `#${entry.item.edition} of ${entry.collection.supply}`
      : `#${entry.item.edition}`
    : privateBalances
      ? '•••• ' + symbol
      : available === undefined
        ? '—'
        : quark
          ? '1 of 1'
          : formatBalance(available, decimals) + ' ' + symbol;
  const fiat =
    privateBalances || quark || available === undefined
      ? undefined
      : native
        ? usdOf(available)
        : asset && qtcValueOf(asset) > 0n
          ? usdOf(qtcValueOf(asset))
          : undefined;
  $('token-fiat').hidden = !fiat;
  $('token-fiat').textContent = fiat ?? '';
  // The asset ID is in the rows below, with Copy; only an item names its Quark here.
  $('token-id').textContent = entry ? `Quark #${entry.item.quark}` : '';
  $('token-id').hidden = !entry;
  const traits = entry?.item.traits ?? [];
  $('token-traits').hidden = !traits.length;
  $('token-traits').replaceChildren(
    ...traits.map(([type, trait]) => {
      const card = node('div', '');
      card.append(node('dt', type), node('dd', trait));
      card.title = `${type}: ${trait}`;
      return card;
    }),
  );
  // First, so the Value row below uses the price the page shows.
  paintMarket();
  const token = catalogue?.tokens.find((t) => t.id === id);
  const rows: [string, string][] = [];
  if (entry) {
    const { collection, item } = entry;
    rows.push([
      'Collection',
      collection.name === collection.symbol ? collection.name : `${collection.name} · ${collection.symbol}`,
    ]);
    if (item.rank) rows.push(['Rarity rank', `#${item.rank}${collection.supply ? ` of ${collection.supply}` : ''}`]);
  }
  const role = quark && !entry && asset ? roleOf(asset) : null;
  if (role)
    rows.push([
      'Collection',
      role.role === 'mint'
        ? `${role.symbol} mint, not counted yet. A mint counts once it is final and the collection's rules accept it; this Quark stays yours either way.`
        : `${role.symbol} · ${ROLE_LABEL[role.role][0]} document of the collection`,
    ]);
  if (!native && asset) rows.push(['Asset ID', id]);
  if (token?.lots) rows.push(['Minted', `${token.lots.minted} / ${token.lots.total} lots`]);
  if (token?.holders) rows.push(['Holders', String(token.holders)]);
  if (asset && !native && !quark && !privateBalances) {
    const value = qtcValueOf(asset);
    if (value > 0n) rows.push(['Value', 'About ' + formatBalance(value, 12) + ' QTC']);
  }
  pairs('token-rows', rows);
  const idTerm = [...$('token-rows').querySelectorAll('dt')].find((dt) => dt.textContent === 'Asset ID');
  if (idTerm?.nextElementSibling) {
    const dd = idTerm.nextElementSibling as HTMLElement;
    dd.classList.add('copy-value');
    dd.title = id;
    dd.replaceChildren(node('span', short(id), 'mono'), copyButton('Asset ID', id));
  }
  $('token-receive').hidden = quark;
  $('token-receive').parentElement!.toggleAttribute('data-single', quark);
  $('token-open').hidden = native;
  $('token-open').firstChild!.textContent = entry
    ? 'View item on Qlyphs '
    : quark
      ? 'View Quark on Qlyphs '
      : 'View on Qlyphs ';
  $<HTMLButtonElement>('token-send').disabled = !native && !asset;
}
$('token-send').addEventListener('click', () => openSend(shownToken, $('token-send')));
onClick('token-receive', () => showReceive($('token-receive')));
onClick('collection-open', async () => {
  if (shownCollection) await openPage({ kind: 'collection', symbol: shownCollection });
});
onClick('token-open', async () => {
  const asset = assets.find((a) => a.id === shownToken);
  const entry = collectionItems.get(shownToken);
  if (entry)
    await openPage({ kind: 'collection-item', symbol: entry.collection.symbol, edition: entry.item.edition });
  else if (isQlyph(asset) && asset?.qlyph) await openPage({ kind: 'quark', number: asset.qlyph.number });
  else await openPage({ kind: 'token', id: shownToken });
});

/* Explore: the Qlyphs catalogue, read from the indexer, and the collections the Qlyphs app lists.
 * Tapping a token or a collection opens its page on Qlyphs. */
let catalogue: { tokens: CatalogToken[]; more: boolean } | undefined;
let collectionCatalogue: { open: boolean; collections: CollectionSummary[] } | undefined;
async function loadCollectionCatalogue() {
  try {
    collectionCatalogue = await call<{ open: boolean; collections: CollectionSummary[] }>('discover-collections');
  } catch {
    // Explore still lists tokens; the next visit asks again.
  }
}
/** A thin progress bar, read out as a progress bar. */
function miniBar(label: string, now: number, max: number) {
  const bar = node('span', '', 'mini-bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', label);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(max));
  bar.setAttribute('aria-valuenow', String(now));
  const fill = node('i', '');
  fill.style.setProperty('--progress', String(max ? Math.min(1, now / max) : 0));
  bar.append(fill);
  return bar;
}
/** One Explore line: mark, name and progress, and a figure on the right. The whole line opens the
 * page on Qlyphs. */
function exploreRow(mark: HTMLElement, name: string, sub: HTMLElement[], figure: string, note: string, urgent = false) {
  const row = node('button', '', 'explore-row') as HTMLButtonElement;
  row.type = 'button';
  const info = node('span', '', 'explore-info');
  const line = node('span', '', 'explore-sub');
  line.append(...sub);
  info.append(node('strong', name), line);
  const side = node('span', '', 'explore-side');
  const small = node('small', note);
  if (urgent) small.classList.add('urgent');
  side.append(node('strong', figure), small);
  row.append(mark, info, side);
  return row;
}
function collectionRow(c: CollectionSummary) {
  const mark = node('span', '', 'collection-mark medium');
  mark.setAttribute('aria-hidden', 'true');
  if (c.cover) mark.append(quarkArt(c.cover.contentType, c.cover.content, c.name, ''));
  const share = c.supply ? Math.floor((c.minted * 1000) / c.supply) / 10 : 0;
  const row = exploreRow(
    mark,
    c.name,
    c.supply
      ? [miniBar(`${c.name} items minted`, c.minted, c.supply), node('span', `${share}%`)]
      : [node('span', 'Open edition')],
    c.supply ? `${c.minted} / ${c.supply}` : String(c.minted),
    'minted',
  );
  row.classList.add('collection-row');
  row.title = c.symbol;
  const progress = c.supply ? `${c.minted} of ${c.supply} minted` : `${c.minted} minted, open edition`;
  row.setAttribute('aria-label', `${c.name}, ${progress}. Open on Qlyphs`);
  row.addEventListener('click', () => void task(() => openPage({ kind: 'collection', symbol: c.symbol }), row));
  return row;
}
let catalogueAt = 0;
async function loadCatalogue(force = false) {
  if (!force && catalogue && Date.now() - catalogueAt < 30_000) return;
  catalogue = await call<{ tokens: CatalogToken[]; more: boolean }>('discover');
  catalogueAt = Date.now();
}
function mintRow(token: CatalogToken) {
  const lots = token.lots!;
  const fee = BigInt(lots.nextFee!);
  const share = Math.floor((lots.minted * 1000) / lots.total) / 10;
  // The price steps up every 200 lots: close to the next step, say when and by how much.
  const next = lots.nextTierFee === null ? null : BigInt(lots.nextTierFee);
  const soon = next !== null && lots.leftInTier <= 50;
  const row = exploreRow(
    markOf(token.id),
    token.symbol,
    [miniBar(`${token.symbol} lots minted`, lots.minted, lots.total), node('span', `${share}%`)],
    formatBalance(fee, 12) + ' QTC',
    soon
      ? `×${(Number((next! * 100n) / fee) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} in ${lots.leftInTier} ${lots.leftInTier === 1 ? 'lot' : 'lots'}`
      : 'per lot',
    soon,
  );
  row.classList.add('mint-row');
  row.title = token.id;
  row.setAttribute(
    'aria-label',
    `${token.symbol}, ${formatBalance(fee, 12)} QTC per lot, ${share}% minted. Mint ${token.symbol} on Qlyphs`,
  );
  row.addEventListener('click', () => void task(() => openPage({ kind: 'token', id: token.id, mint: true }), row));
  return row;
}
const TRENDING = 5;
/** Explore lists opened with See all. */
const exploreAll = new Set<string>();
function paintExplore() {
  const box = $('explore');
  if (!catalogue) return;
  const query = value('explore-search').trim().toLowerCase();
  const tokens = catalogue.tokens.filter(
    (t) => !query || t.symbol.toLowerCase().includes(query) || t.id.includes(query),
  );
  // Each list shows its five busiest, ranked, unless a search asks for every match.
  const section = (title: string, rows: HTMLElement[], id: string) => {
    const s = node('section', '', 'explore-section');
    s.id = id;
    const all = !!query || exploreAll.has(id);
    const shown = all ? rows : rows.slice(0, TRENDING);
    if (!query)
      shown.forEach((row, i) => {
        const rank = node('span', String(i + 1), 'explore-rank');
        rank.setAttribute('aria-hidden', 'true');
        row.prepend(rank);
      });
    s.append(node('h2', title, 'list-heading'), ...shown);
    if (!query && rows.length > TRENDING) {
      const more = node('button', all ? 'Show less' : `See all ${rows.length}`, 'text-button explore-more') as HTMLButtonElement;
      more.type = 'button';
      more.setAttribute('aria-expanded', String(all));
      more.addEventListener('click', () => {
        if (all) exploreAll.delete(id);
        else exploreAll.add(id);
        paintExplore();
        $(id).querySelector<HTMLElement>('.explore-more')?.focus({ preventScroll: true });
      });
      s.append(more);
    }
    return s;
  };
  // Only tokens that can still be minted, the most active first.
  const minting = tokens.filter((t) => t.lots?.nextFee).sort((a, b) => b.transactions - a.transactions);
  const sets = (collectionCatalogue?.collections ?? []).filter(
    (c) => !query || c.name.toLowerCase().includes(query) || c.symbol.toLowerCase().includes(query),
  );
  if (!minting.length && !sets.length) {
    box.replaceChildren(
      empty(
        query ? 'Nothing found' : 'Nothing to mint right now',
        query ? 'Try another name, symbol or asset ID.' : 'Every lot of every token is minted.',
        'search',
      ),
    );
    return;
  }
  box.replaceChildren(
    ...(minting.length ? [section('Minting now', minting.map(mintRow), 'explore-mint')] : []),
    ...(sets.length ? [section('Collections', sets.map(collectionRow), 'explore-collections')] : []),
  );
}
async function showExplore(force = false) {
  if (!catalogue) $('explore').replaceChildren(node('div', '', 'skeleton'), node('div', '', 'skeleton'), node('div', '', 'skeleton'));
  try {
    await Promise.all([loadCatalogue(force), loadCollectionCatalogue()]);
    paintExplore();
    if (balanceView) paintBalances();
  } catch {
    if (!catalogue)
      $('explore').replaceChildren(empty('Qlyphs is unavailable', 'Check your connection, then try again.', 'refresh'));
  }
}
$('explore-search').addEventListener('input', paintExplore);
// Each visit asks again: the background keeps the catalogue for 30 s, so this stays cheap.
$('tab-explore').addEventListener('click', () => void showExplore(true));


/* Points: the account's level on Qlyphs, read from the indexer. */
async function loadPoints() {
  const owner = state?.account?.owner;
  if (!owner || !state?.unlocked || pointsOwner === owner) return;
  pointsOwner = owner;
  try {
    paintPoints(await call<PointsView | null>('points'), true);
  } catch {
    pointsOwner = undefined;
  }
}
/** Fills the hexagon's six sides, clockwise from the top, by the share of the level done. */
function paintHexagon(progress: number) {
  const sides = $('points-badge').querySelectorAll('.hex-fill');
  sides.forEach((side, i) => {
    const fill = Math.min(1, Math.max(0, progress * sides.length - i));
    (side as SVGElement).style.setProperty('--fill', String(Number(fill.toFixed(3))));
    side.toggleAttribute('data-empty', fill === 0);
  });
}
/** `null` hides the card (locked, or no answer); an account without XP yet shows level 0. */
function paintPoints(p: PointsView | null, empty = false) {
  const badge = $('points-badge');
  badge.hidden = !p && !empty;
  if (!p) {
    if (!empty) return;
    paintHexagon(0);
    $('points-title').textContent = 'Level 0';
    $('points-detail').textContent = 'Mint, trade or create on Qlyphs to earn XP';
    badge.setAttribute('aria-label', 'No Qlyphs XP yet. Open the points page');
    return;
  }
  const from = BigInt(p.levelFrom),
    to = BigInt(p.levelTo),
    xp = BigInt(p.xp);
  const progress = to > from ? Number(((xp - from) * 100n) / (to - from)) / 100 : 1;
  paintHexagon(progress);
  $('points-title').textContent = 'Level ' + p.level;
  $('points-detail').textContent = to > xp ? `${formatBalance(xp, 0)} / ${formatBalance(to, 0)} XP` : formatBalance(xp, 0) + ' XP';
  badge.setAttribute(
    'aria-label',
    `Level ${p.level}, ${formatBalance(xp, 0)} XP on Qlyphs, ${Math.round(Math.min(1, Math.max(0, progress)) * 100)}% of the way to level ${p.level + 1}. Open the points page`,
  );
}
onClick('points-badge', () => openPage({ kind: 'points' }));
let lastBalance: { owner?: string; free: bigint } | undefined;
let deltaTimer: ReturnType<typeof setTimeout> | undefined;
function balanceDelta(delta: bigint) {
  const up = delta > 0n;
  const size = formatBalance(up ? delta : -delta, 12);
  const element = $('balance-delta');
  element.textContent = up ? `+${size} QTC received` : `−${size} QTC`;
  element.dataset.tone = up ? 'up' : 'down';
  element.dataset.visible = 'true';
  flash($('balance'), up ? 'up' : 'down');
  clearTimeout(deltaTimer);
  deltaTimer = setTimeout(() => delete element.dataset.visible, 4200);
}
function paintBalances() {
  const v = balanceView;
  if (!v) return;
  // Show the current on-chain balance, including successful receipts before finality.
  // The send form separately uses spendableBalance and retains the finality checks.
  const free = BigInt(v.balance.free);
  const amount = formatBalance(free, 12);
  const exactAmount = formatUnits(free, 12);
  const before = lastBalance && lastBalance.owner === v.owner ? lastBalance.free : undefined;
  lastBalance = { owner: v.owner, free };
  const held = assets.filter((a) => BigInt(a.available) > 0n);
  const tokens = held.filter((a) => !isQlyph(a));
  // With the QTC price, the total is in dollars: QTC and every token valued, as wallets show it.
  const total = totalDollars(free, tokens);
  if (total) {
    $('balance').replaceChildren(document.createTextNode(privateBalances ? '••••' : formatUsdValue(total.now)));
    if (before !== undefined && before !== free && !privateBalances) balanceDelta(free - before);
  } else
    $('balance').replaceChildren(
      document.createTextNode(privateBalances ? '••••' : amount),
      node('small', ' QTC'),
    );
  if (!total && before !== undefined && before !== free && !privateBalances) {
    // Show the change itself, then settle on the exact new balance.
    const decimals = Math.min(4, (amount.split('.')[1] ?? '').length);
    roll(
      $('balance'),
      Number(before) / 1e12,
      Number(free) / 1e12,
      (n) => n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
      amount,
    );
    balanceDelta(free - before);
  }
  $('balance').setAttribute(
    'aria-label',
    privateBalances ? 'Balance hidden' : total ? 'Total ' + formatUsdValue(total.now) : amount + ' QTC',
  );
  $('balance').title = privateBalances ? '' : exactAmount + ' QTC' + (total && tokens.length ? ' and your tokens' : '');
  const qtcLine = privateBalances ? undefined : dollarLine(free, free);
  // Under the total: its change over 24 hours, then anything reserved or frozen.
  const parts: (string | HTMLElement)[] = [];
  if (total && !privateBalances && total.then > 0) {
    const change = total.now - total.then;
    const line = node('span', `${formatUsdChange(change)} (${change < 0 ? '−' : '+'}${Math.abs((change / total.then) * 100).toFixed(2)}%)`, 'total-change');
    line.dataset.tone = Math.abs(change) < 0.005 ? 'flat' : change > 0 ? 'up' : 'down';
    parts.push(line);
  }
  if (!privateBalances && (BigInt(v.balance.reserved) || BigInt(v.balance.frozen)))
    parts.push(
      `Reserved ${formatBalance(BigInt(v.balance.reserved), 12)} · Frozen ${formatBalance(BigInt(v.balance.frozen), 12)} QTC`,
    );
  $('reserved').replaceChildren(...parts.flatMap((p, i) => (i ? [' · ', p] : [p])));
  if (parts.length) $('reserved').dataset.visible = 'true';
  else delete $('reserved').dataset.visible;
  $('tokens').replaceChildren(
    assetRow(
      'QTC',
      '',
      amount,
      undefined,
      exactAmount,
      qtcLine?.value,
      qtcLine?.change ? { text: qtcLine.change, tone: qtcLine.tone! } : undefined,
    ),
    ...tokens.map((a) => {
      const line = tokenDollars(a);
      return assetRow(
        a.definition.symbol,
        '',
        formatBalance(BigInt(a.available), a.definition.decimals),
        a.id,
        formatUnits(BigInt(a.available), a.definition.decimals),
        line?.value ?? valueOf(a),
        line?.change ? { text: line.change, tone: line.tone! } : undefined,
      );
    }),
  );
  $('asset-count').textContent = String(tokens.length + 1);
  if ($('token-panel').hasAttribute('open')) paintToken();
  if (v.more)
    $('tokens').append(
      node('p', 'More assets available. Open Qlyphs to see all pages.', 'field-hint'),
    );
  const select = $<HTMLSelectElement>('send-asset'),
    previous = select.value;
  const native = document.createElement('option');
  native.value = 'qtc';
  native.textContent = 'QTC · Native token';
  select.replaceChildren(
    native,
    ...held.map((a) => {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = ownName(a) + ' · ' + short(a.id);
      o.title = a.id;
      return o;
    }),
  );
  if (previous && previous !== 'qtc' && !held.some((a) => a.id === previous)) {
    // Keep a vanished selection explicit; never silently turn a token draft into QTC.
    const unavailable = document.createElement('option');
    unavailable.value = previous;
    unavailable.textContent = 'Unavailable asset · ' + short(previous);
    select.append(unavailable);
  }
  select.value = previous || 'qtc';
  sendAssetDetails();
  paintHoldings();
}
function sendAssetDetails() {
  const id = value('send-asset');
  const asset = assets.find((a) => a.id === id && BigInt(a.available) > 0n);
  const native = id === 'qtc';
  const symbol = native ? 'QTC' : asset ? ownName(asset) : undefined;
  const item = asset ? collectionItems.get(asset.id) : undefined;
  // A Quark moves as a whole: the amount is fixed to 1.
  const whole = isQlyph(asset),
    amount = $<HTMLInputElement>('send-amount');
  amount.readOnly = whole;
  if (whole) amount.value = '1';
  $('send-title').textContent = symbol ? 'Send ' + symbol : 'Send asset';
  paintAssetPicker();
  $('send-unit').textContent = symbol ?? '—';
  $('send-unit').title = symbol ?? '';
  $('send-asset').title = native ? 'QTC · Quantus native token' : id;
  const available = native ? freeBalance : asset ? BigInt(asset.available) : undefined;
  $('send-available').textContent = item
    ? `Collection item · Quark #${item.item.quark}. The item moves to the recipient.`
    : whole
      ? 'Quark · 1 of 1. The whole Quark moves to the recipient.'
    : available === undefined
      ? 'Balance unavailable. Refresh before sending.'
      : privateBalances
        ? 'Balance hidden'
        : `Available: ${formatUnits(available, native ? 12 : asset!.definition.decimals)} ${symbol}` +
          (native && balanceView && incomingBalance(balanceView.balance)
            ? ` ${formatBalance(incomingBalance(balanceView.balance), 12)} QTC locked until final.`
            : '');
}
/** The asset picker: the selected asset's mark, name and balance; the list shows every asset held. */
function assetChoices() {
  return [...$<HTMLSelectElement>('send-asset').options].map((o) => {
    const native = o.value === 'qtc';
    const asset = native ? undefined : assets.find((a) => a.id === o.value);
    const name = native ? 'QTC' : asset ? ownName(asset) : o.textContent!;
    const balance = native
      ? freeBalance !== undefined
        ? formatBalance(freeBalance, 12) + ' QTC'
        : ''
      : asset
        ? isQlyph(asset)
          ? '1 of 1'
          : formatBalance(BigInt(asset.available), asset.definition.decimals) + ' ' + name
        : 'Unavailable';
    return { value: o.value, name, balance: privateBalances ? '••••' : balance, native, quark: isQlyph(asset) };
  });
}
function paintAssetPicker() {
  const id = value('send-asset');
  const choice = assetChoices().find((c) => c.value === id);
  $('send-asset-mark').replaceChildren(id === 'qtc' ? qtcMark() : markOf(id));
  $('send-asset-name').textContent = choice?.name ?? 'Choose an asset';
  $('send-asset-balance').textContent = choice?.balance ?? '';
  $('send-max').hidden = !!choice?.quark;
}
function closeAssetList(focus = false) {
  $('send-asset-list').hidden = true;
  $('send-asset-button').setAttribute('aria-expanded', 'false');
  if (focus) $('send-asset-button').focus({ preventScroll: true });
}
function openAssetList() {
  const list = $('send-asset-list');
  const selected = value('send-asset');
  list.replaceChildren(
    ...assetChoices().map((c) => {
      const option = node('button', '', 'picker-option') as HTMLButtonElement;
      option.type = 'button';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(c.value === selected));
      const info = node('span', '', 'asset-info');
      info.append(node('strong', c.name), node('small', c.balance));
      option.append(c.native ? qtcMark() : markOf(c.value), info);
      option.title = c.native ? '' : c.value;
      option.addEventListener('click', () => {
        const select = $<HTMLSelectElement>('send-asset');
        if (select.value !== c.value) {
          select.value = c.value;
          select.dispatchEvent(new Event('change'));
        }
        closeAssetList(true);
      });
      return option;
    }),
  );
  list.hidden = false;
  $('send-asset-button').setAttribute('aria-expanded', 'true');
  list.querySelector<HTMLElement>('[aria-selected=true]')?.focus({ preventScroll: true });
}
$('send-asset-button').addEventListener('click', () =>
  $('send-asset-list').hidden ? openAssetList() : closeAssetList(),
);
$('send-asset-list').addEventListener('keydown', (e) => {
  const options = [...$('send-asset-list').querySelectorAll<HTMLElement>('[role=option]')];
  const at = options.indexOf(document.activeElement as HTMLElement);
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeAssetList(true);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    options[(at + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length]?.focus();
  }
});
document.addEventListener('pointerdown', (e) => {
  if (!$('send-asset-list').hidden && !(e.target as Element).closest('#send-asset-list, #send-asset-button'))
    closeAssetList();
});
/* Recipients: the book in the recipient field opens the wallet's other accounts and the addresses
   this account sent to. Choosing one only fills the field; the review shows the full address. */
const recipientSheet = $<HTMLDialogElement>('recipient-sheet');
let recipientChosen = false;
/** The wallet's account an entered address belongs to, if any. */
function ownAccountAt(text: string) {
  let id: string;
  try {
    id = recipient(text.trim());
  } catch {
    return undefined;
  }
  return state?.accounts?.find((a) => a.owner === id);
}
/** Names the account under the field when the recipient is one of this wallet's. */
function paintRecipientName() {
  const own = ownAccountAt(value('send-to'));
  const hint = $('send-to-name');
  hint.hidden = !own || own.owner === state?.account?.owner;
  if (own) hint.replaceChildren('Your account ', node('strong', own.name));
}
/** Addresses this account sent QTC or tokens to, latest first, its own accounts left out. */
function recentRecipients(limit = 8) {
  const seen = new Map<string, number | undefined>();
  for (const tx of history) {
    if ((tx.label !== 'sendQtc' && tx.label !== 'transfer') || !tx.to || !/^0x[0-9a-f]{64}$/.test(tx.to)) continue;
    if (tx.status === 'cancelled-before-broadcast' || seen.has(tx.to)) continue;
    if (state?.accounts?.some((a) => a.owner === tx.to)) continue;
    seen.set(tx.to, tx.createdAt);
    if (seen.size === limit) break;
  }
  return [...seen];
}
function recipientRow(group: string, owner: string, address: string, title: string, detail: string, search: string) {
  const row = node('div', '', 'account-option');
  row.dataset.group = group;
  row.dataset.search = search.toLocaleLowerCase();
  const button = node('button', '', 'account-choice') as HTMLButtonElement;
  button.type = 'button';
  button.title = address;
  const avatar = node('span', '', 'account-avatar');
  avatar.setAttribute('aria-hidden', 'true');
  paintAccountAvatar(avatar, owner);
  const info = node('span', '', 'account-option-info');
  info.append(node('strong', title, group === 'recent' ? 'mono' : ''), node('small', detail, group === 'recent' ? '' : 'mono'));
  button.append(avatar, info);
  button.addEventListener('click', () => {
    const input = $<HTMLInputElement>('send-to');
    input.value = address;
    transferFeedback('send-to');
    paintRecipientName();
    recipientChosen = true;
    recipientSheet.close();
    $('send-amount').focus({ preventScroll: true });
  });
  row.append(button);
  return row;
}
function paintRecipients() {
  const others = (state?.accounts ?? []).filter((a) => a.owner !== state?.account?.owner);
  const recent = recentRecipients();
  const heading = (group: string, text: string) => {
    const h = node('div', text, 'account-wallet-heading');
    h.dataset.group = group;
    return h;
  };
  $('recipient-list').replaceChildren(
    ...(others.length ? [heading('own', 'Your accounts')] : []),
    ...others.map((a) => recipientRow('own', a.owner, a.address, a.name, short(a.address), `${a.name} ${a.address} ${a.owner}`)),
    ...(recent.length ? [heading('recent', 'Recent')] : []),
    ...recent.map(([to, at]) => {
      const address = fullAddress(to);
      const day = activityDay(at);
      const when = day === 'Earlier' ? 'Sent before' : 'Last sent ' + (/^(Today|Yesterday)$/.test(day) ? day.toLowerCase() : day);
      return recipientRow('recent', to, address, short(address), when, `${address} ${to}`);
    }),
  );
}
function filterRecipients() {
  const query = value('recipient-search').trim().toLocaleLowerCase();
  const rows = [...$('recipient-list').querySelectorAll<HTMLElement>('.account-option')];
  for (const row of rows) row.hidden = !row.dataset.search!.includes(query);
  for (const heading of $('recipient-list').querySelectorAll<HTMLElement>('.account-wallet-heading'))
    heading.hidden = !rows.some((row) => !row.hidden && row.dataset.group === heading.dataset.group);
  const none = rows.every((row) => row.hidden);
  const emptyState = $('recipient-empty');
  emptyState.hidden = !none;
  emptyState.querySelector('strong')!.textContent = rows.length ? 'No match' : 'No recipients yet';
  emptyState.querySelector('p')!.textContent = rows.length
    ? 'Try another name or address, or paste the address in the field.'
    : 'Your other accounts and the addresses you send to will show up here.';
  $('recipient-search').closest('label')!.hidden = !rows.length;
}
$('send-book').addEventListener('click', () => {
  paintRecipients();
  $<HTMLInputElement>('recipient-search').value = '';
  filterRecipients();
  recipientChosen = false;
  recipientSheet.showModal();
  const first = $<HTMLInputElement>('recipient-search');
  (first.closest('label')!.hidden ? $('close-recipients') : first).focus({ preventScroll: true });
});
$('recipient-search').addEventListener('input', filterRecipients);
$('close-recipients').addEventListener('click', () => recipientSheet.close());
recipientSheet.addEventListener('click', (event) => {
  if (event.target === recipientSheet) recipientSheet.close();
});
recipientSheet.addEventListener('close', () => {
  if (!recipientChosen && $<HTMLDetailsElement>('send-panel').open) $('send-book').focus({ preventScroll: true });
});
$('send-to').addEventListener('input', paintRecipientName);
/** Keeps this much QTC for the network fee when sending the whole balance; the review shows the
 * exact fee, and the background refuses a send that cannot pay it. */
const MAX_FEE_RESERVE = 10_000_000_000n;
const EXISTENTIAL_DEPOSIT = 1_000_000_000n;
$('send-max').addEventListener('click', () => {
  const id = value('send-asset');
  let amount: bigint, decimals: number;
  if (id === 'qtc') {
    if (!balanceView) return;
    const spendable = spendableBalance(balanceView.balance, EXISTENTIAL_DEPOSIT);
    amount = spendable > MAX_FEE_RESERVE ? spendable - MAX_FEE_RESERVE : 0n;
    decimals = 12;
  } else {
    const asset = assets.find((a) => a.id === id);
    if (!asset) return;
    amount = BigInt(asset.available);
    decimals = asset.definition.decimals;
  }
  $<HTMLInputElement>('send-amount').value = formatUnits(amount, decimals);
  transferFeedback('send-amount');
  if (id === 'qtc')
    $('send-available').textContent = `Max keeps ${formatUnits(MAX_FEE_RESERVE, 12)} QTC for the network fee. The review shows the exact fee.`;
});
function changeSendAsset() {
  $<HTMLInputElement>('send-amount').value = '';
  transferFeedback('send-amount');
  sendAssetDetails();
}
function openSend(id = 'qtc', trigger: HTMLElement = $('show-send')) {
  paintRecipientName();
  closeAssetList();
  const select = $<HTMLSelectElement>('send-asset');
  if (select.value !== id) {
    select.value = id;
    changeSendAsset();
  } else sendAssetDetails();
  openPanel('send-panel', trigger);
}
async function balances(quiet = false) {
  if (!state?.account) return;
  if (backgroundNeedsUpdate())
    throw Error('Wallet update pending. Reload the extension to finish updating.');
  if (!quiet) document.body.dataset.refreshing = 'true';
  const owner = state.account.owner,
    request = ++balanceRequest;
  pendingBalanceRequests++;
  lastBalanceRefresh = Date.now();
  try {
    const v = await call<BalanceView>('balances');
    if (
      request !== balanceRequest ||
      state?.account?.owner !== owner ||
      (v.owner && v.owner !== owner)
    )
      return;
    balanceView = v;
    recordChain(v.chain);
    assets = v.assets;
    freeBalance = spendableBalance(v.balance);
    paintBalances();
    renderHistory(v.transactions);
    paintTracker(v.transactions);
    $('sync-state').textContent =
      'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    delete $('sync-state').dataset.state;
    void loadPoints();
    void loadCollections();
    void loadQtcPrice();
    void loadHeldTrades(v.assets.filter((a) => BigInt(a.available) > 0n && !isQlyph(a)));
    if (!catalogue) void showExplore();
  } catch (e) {
    if (request !== balanceRequest || state?.account?.owner !== owner) return;
    $('sync-state').textContent = balanceView
      ? 'Refresh failed · Showing previously loaded balances.'
      : 'Balances unavailable · Try refreshing.';
    $('sync-state').dataset.state = 'error';
    if (!balanceView)
      $('tokens').replaceChildren(
        empty(
          'Unable to load assets',
          MAINNET_BUILD ? 'Check your connection, then refresh.' : 'Check your local Quantus node, then refresh.',
          'refresh',
        ),
      );
    throw e;
  } finally {
    pendingBalanceRequests--;
    if (request === balanceRequest) document.body.dataset.refreshing = 'false';
  }
}
function resetAccountView() {
  seenActivity.clear();
  assetAmounts.clear();
  lastBalance = undefined;
  delete $('balance-delta').dataset.visible;
  lastBalanceRefresh = 0;
  $<HTMLDialogElement>('reset-dialog').close();
  balanceRequest++;
  balanceView = undefined;
  freeBalance = undefined;
  assets = [];
  watchOnly = false;
  if (txSheet.open) txSheet.close();
  $<HTMLDialogElement>('recipient-sheet').close();
  closeClearActivity();
  $('balance').textContent = '—';
  $('balance').removeAttribute('title');
  $('balance').removeAttribute('aria-label');
  $('wallet').scrollTop = 0;
  syncWalletScroll();
  $('tokens').replaceChildren();
  $('quarks').replaceChildren();
  $('quark-count').textContent = '0';
  holdings = undefined;
  holdingsFailed = false;
  holdingsRequest++;
  collectionItems.clear();
  groupsBySymbol.clear();
  shownCollection = undefined;
  $<HTMLDetailsElement>('collection-panel').open = false;
  $('collections').replaceChildren();
  $('collection-count').textContent = '0';
  $('collectible-count').textContent = '0';
  $('history').replaceChildren();
  $('send-asset').replaceChildren(new Option('QTC · Native token', 'qtc'));
  sendAssetDetails();
  $('sync-state').textContent = '';
  delete $('sync-state').dataset.state;
  pointsOwner = undefined;
  paintPoints(null);
  selectHome($<HTMLButtonElement>('home-tokens'));
  $('receive-address').textContent = '';
  const canvas = $<HTMLCanvasElement>('receive-qr');
  canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  for (const form of document.querySelectorAll<HTMLFormElement>('#wallet form')) form.reset();
  clearTransferFeedback();
  // Screens close; the folded Collectibles sections keep the viewer's choice.
  for (const panel of document.querySelectorAll<HTMLDetailsElement>('#wallet details[open]:not(.collectible-block)'))
    panel.open = false;
  clearSecrets();
  $('phrase').textContent = '';
  $('recovery').hidden = true;
}
/** Same wallet, other network: this page follows in place, on the same tab. Only what the old
 * network showed (balances, assets, activity) is cleared, then read again. */
async function followNetwork(name: 'mainnet' | 'development') {
  useNetwork(name);
  paintNetwork();
  resetNetworkView();
  await render();
  if (state?.unlocked || watchOnly) await balances(true);
}
/** After a network switch: forget everything the old chain showed, keep how the wallet is viewed. */
function resetNetworkView() {
  catalogue = undefined;
  logoRequests.clear();
  const watching = watchOnly,
    scroll = $('wallet').scrollTop;
  resetAccountView();
  watchOnly = watching;
  // The user switched from Settings: stay where they were.
  $('wallet').scrollTop = scroll;
  syncWalletScroll();
  chainSamples.length = 0;
  awaitingSince = awaitingRequest = trackedHash = undefined;
  paintTracker([]);
}
function positionAccountMenu(menu: HTMLElement, options: HTMLElement) {
  const rect = options.getBoundingClientRect();
  menu.style.left =
    Math.max(12, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 12)) +
    'px';
  menu.style.top =
    Math.max(12, Math.min(rect.bottom + 6, innerHeight - menu.offsetHeight - 12)) + 'px';
}
function populateAccounts() {
  const all: WalletAccount[] =
    state?.accounts ??
    (state?.account
      ? [
          {
            ...state.account,
            name: state.name ?? 'Account 1',
            backed: state.backed,
          },
        ]
      : []);
  const walletOwners = [...new Set(all.map((a) => a.walletOwner ?? a.owner))];
  const ordered = walletOwners.flatMap((owner) =>
    all.filter((a) => (a.walletOwner ?? a.owner) === owner),
  );
  $('accounts-list').replaceChildren(
    ...ordered.flatMap((account, position) => {
      const row = node('div', '', 'account-option');
      const selected = account.owner === state?.account?.owner;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'account-choice';
      button.setAttribute(
        'aria-label',
        `${account.name}, ${short(account.address)}${selected ? ', selected' : ''}`,
      );
      if (selected) button.setAttribute('aria-current', 'true');
      const avatar = node('span', '', 'account-avatar');
      avatar.setAttribute('aria-hidden', 'true');
      paintAccountAvatar(avatar, account.owner);
      const info = node('span', '', 'account-option-info');
      const name = node('span', '', 'account-option-name');
      name.append(node('strong', account.name));
      if (selected) name.append(node('span', 'Active', 'account-active'));
      info.append(name, node('small', short(account.address), 'mono'));
      button.append(avatar, info);
      row.dataset.search =
        `${account.name} ${account.address} ${account.owner}`.toLocaleLowerCase();
      button.addEventListener(
        'click',
        () =>
          void task(async () => {
            try {
              if (!selected) {
                await call('account-select', { owner: account.owner });
                await render();
                message(`Switched to ${account.name}.`, false, true);
                arrive($('open-accounts'));
              }
              $<HTMLDialogElement>('accounts-dialog').close();
              if (!selected && !state?.unlocked) $('password').focus({ preventScroll: true });
              else $('open-accounts').focus({ preventScroll: true });
              if (!selected && state?.unlocked) await balances();
            } catch (error) {
              // Keep the selection usable even when this account's network is offline.
              await render();
              $('accounts-error').textContent = (error as Error).message;
              nudge($('accounts-error'));
      nudge($('accounts-error'));
            }
          }, button),
      );
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'account-menu-action';
      rename.setAttribute('role', 'menuitem');
      rename.setAttribute('aria-label', `Rename ${account.name}`);
      rename.title = 'Rename account';
      rename.append(icon('edit'), document.createTextNode('Rename account'));
      rename.addEventListener('click', () => {
        if (busy) return;
        menu.hidePopover();
        renamedOwner = account.owner;
        $('accounts-overview').hidden = true;
        $('account-name-form').hidden = false;
        $('accounts-title').textContent = 'Rename account';
        $('close-accounts').setAttribute('aria-label', 'Back to accounts');
        $<HTMLInputElement>('account-name').value = account.name;
        $('account-name-hint').textContent = 'Only visible in this extension.';
        $('account-name-hint').classList.remove('field-error');
        $('account-name').focus();
        $<HTMLInputElement>('account-name').select();
      });
      const menu = node('div', '', 'account-menu');
      menu.id = `account-menu-${account.owner.slice(2)}`;
      menu.setAttribute('popover', 'auto');
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', `Actions for ${account.name}`);
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'account-menu-action';
      copy.setAttribute('role', 'menuitem');
      copy.setAttribute('aria-label', `Copy address for ${account.name}`);
      copy.append(icon('copy'), document.createTextNode('Copy address'));
      copy.addEventListener(
        'click',
        () =>
          void task(async () => {
            await copyText(copy, account.address);
          }, copy),
      );
      menu.append(copy, rename);
      const options = document.createElement('button');
      options.type = 'button';
      options.className = 'icon account-options';
      options.title = 'Account options';
      options.setAttribute('aria-haspopup', 'menu');
      options.setAttribute('aria-label', `Options for ${account.name}`);
      options.setAttribute('aria-expanded', 'false');
      options.setAttribute('aria-controls', menu.id);
      options.append(icon('more'));
      const openMenu = (last = false) => {
        if (busy) return;
        menu.showPopover();
        positionAccountMenu(menu, options);
        (last ? rename : copy).focus({ preventScroll: true });
      };
      options.addEventListener('click', () => {
        if (busy) return;
        if (menu.matches(':popover-open')) {
          menu.hidePopover();
          return;
        }
        openMenu();
      });
      options.addEventListener('keydown', (event) => {
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault();
        openMenu(event.key === 'ArrowUp');
      });
      menu.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          menu.hidePopover();
          options.focus({ preventScroll: true });
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const items = [copy, rename];
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (current + 1) % 2;
          items[index]!.focus();
        } else if (event.key === 'Tab') {
          // Dismiss before the browser advances from the options trigger.
          menu.hidePopover();
          options.focus({ preventScroll: true });
        }
      });
      menu.addEventListener('toggle', () =>
        options.setAttribute('aria-expanded', String(menu.matches(':popover-open'))),
      );
      row.append(button, options, menu);
      const walletOwner = account.walletOwner ?? account.owner;
      row.dataset.wallet = walletOwner;
      if (
        position === 0 ||
        (ordered[position - 1]!.walletOwner ?? ordered[position - 1]!.owner) !== walletOwner
      ) {
        const heading = node(
          'div',
          `Wallet (${all.filter((a) => (a.walletOwner ?? a.owner) === walletOwner).length})`,
          'account-wallet-heading',
        );
        heading.dataset.wallet = walletOwner;
        return [heading, row];
      }
      return [row];
    }),
  );
  filterAccounts();
  $<HTMLButtonElement>('add-account').disabled = busy || !state?.unlocked || !state.backed || all.length >= 20;
}
function filterAccounts() {
  const query = value('account-search').trim().toLocaleLowerCase();
  let count = 0;
  for (const row of $('accounts-list').querySelectorAll<HTMLElement>('.account-option')) {
    row.hidden = !row.dataset.search?.includes(query);
    if (!row.hidden) count++;
    for (const menu of row.querySelectorAll<HTMLElement>(':popover-open')) menu.hidePopover();
  }
  for (const heading of $('accounts-list').querySelectorAll<HTMLElement>(
    '.account-wallet-heading',
  )) {
    heading.hidden = ![...$('accounts-list').querySelectorAll<HTMLElement>('.account-option')].some(
      (row) => !row.hidden && row.dataset.wallet === heading.dataset.wallet,
    );
  }
  $('accounts-empty').hidden = count !== 0;
  $('accounts-list').hidden = count === 0;
}
function showAccounts(preserveSearch = false) {
  if (!state?.unlocked || requestId || !$('recovery').hidden) return;
  if (!preserveSearch) $<HTMLInputElement>('account-search').value = '';
  $('accounts-overview').hidden = false;
  $('account-name-form').hidden = true;
  $('accounts-title').textContent = 'Accounts';
  $('close-accounts').setAttribute('aria-label', 'Back to wallet');
  $('accounts-error').textContent = '';
  populateAccounts();
  const dialog = $<HTMLDialogElement>('accounts-dialog');
  if (!dialog.open) {
    dialog.showModal();
    motion.reveal(dialog, pointerInput);
  }
  $('close-accounts').focus({ preventScroll: true });
}
const recipient = (s: string) =>
  s.startsWith('0x') ? (fromHex(s, 32), s) : hex(decodeAccountId(s));
const click = (id: string, fn: () => Promise<void>) =>
  $(id).addEventListener('click', () => void task(fn, $(id)));
const form = (id: string, fn: () => Promise<void>) =>
  $(id).addEventListener('submit', (e) => {
    e.preventDefault();
    void task(
      fn,
      (e as SubmitEvent).submitter ?? $(id).querySelector('button[type=submit]') ?? undefined,
    );
  });
$('open-accounts').addEventListener('click', openDrawer);
$('close-accounts').addEventListener('click', () => {
  if (busy) return;
  if (!$('account-name-form').hidden) showAccounts(true);
  else $<HTMLDialogElement>('accounts-dialog').close();
});
$('account-search').addEventListener('input', filterAccounts);
$('accounts-list').addEventListener('scroll', () => {
  const bounds = $('accounts-list').getBoundingClientRect();
  for (const menu of $('accounts-list').querySelectorAll<HTMLElement>(':popover-open')) {
    const options = menu.parentElement!.querySelector<HTMLElement>('.account-options')!;
    const rect = options.getBoundingClientRect();
    if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) menu.hidePopover();
    else positionAccountMenu(menu, options);
  }
});
$('accounts-dialog').addEventListener('cancel', (event) => {
  if (busy) event.preventDefault();
});
$('accounts-dialog').addEventListener('close', () => {
  for (const menu of $('accounts-dialog').querySelectorAll<HTMLElement>(':popover-open'))
    menu.hidePopover();
  renamedOwner = undefined;
  // Opened from the drawer, which is closed by then: focus returns to the account control.
  if (!document.activeElement || document.activeElement === document.body)
    $('open-accounts').focus({ preventScroll: true });
});
$('cancel-account-name').addEventListener('click', () => {
  if (!busy) showAccounts(true);
});
$('add-account').addEventListener('click', () => {
  if (busy) return;
  void task(async () => {
    try {
      await call('account-derive');
      await render();
      $<HTMLDialogElement>('accounts-dialog').close();
      message(`${state?.name ?? 'New account'} added and selected.`, false, true);
      arrive($('open-accounts'));
      await balances();
      $('open-accounts').focus({ preventScroll: true });
    } catch (error) {
      await render();
      $('accounts-error').textContent = (error as Error).message;
      nudge($('accounts-error'));
    }
  }, $('add-account'));
});
form('account-name-form', async () => {
  if (!state?.unlocked) return;
  try {
    const name = accountName(value('account-name'));
    await call('account-rename', { owner: renamedOwner, name });
    await render();
    showAccounts();
    message(`Renamed to ${name}.`, false, true);
    if (renamedOwner === state?.account?.owner) pop($('active-account-name'));
  } catch (error) {
    $('account-name-hint').textContent = (error as Error).message;
    $('account-name-hint').classList.add('field-error');
    $('account-name').focus();
  }
});
// Local navigation never submits a form or changes the pinned network.
for (const [id, screen] of [
  ['choose-create', 'create'],
  ['choose-import', 'import-choice'],
  ['choose-phrase', 'phrase'],
  ['choose-backup', 'backup'],
] as const)
  $(id).addEventListener('click', () => {
    if (!busy) {
      message('');
      onboarding(screen);
    }
  });
$('onboarding-back').addEventListener('click', () => {
  if (busy) return;
  message('');
  const previous: Record<OnboardingScreen, OnboardingScreen> = {
    choice: 'choice',
    create: 'choice',
    'import-choice': 'choice',
    phrase: 'import-choice',
    'import-password': 'phrase',
    backup: 'import-choice',
    'restore-password': 'backup',
  };
  const target = previous[onboardingScreen];
  // Leaving a method discards its secrets; going back within it preserves the draft.
  if (target === 'choice' || target === 'import-choice') {
    clearSecrets();
    $<HTMLInputElement>('backup-file').value = '';
  }
  onboarding(target);
});
$('import-next').addEventListener('click', continueImport);
click('restore-next', async () => {
  if (!$<HTMLInputElement>('backup-file').reportValidity()) return;
  try {
    await readBackup();
    fieldFeedback('backup-file');
    message('');
    onboarding('restore-password');
  } catch (error) {
    fieldFeedback('backup-file', (error as Error).message);
    $('backup-file').focus({ preventScroll: true });
  }
});
$('recovery-next').addEventListener('click', () => {
  if (!busy) recoveryStep(recoveryPage + 1);
});
$('recovery-back').addEventListener('click', () => {
  if (!busy) recoveryStep(recoveryPage - 1);
});
for (const [id, details] of [
  ['show-setup-network', true],
  ['back-setup-network', false],
] as const)
  $(id).addEventListener('click', () => {
    if (busy) return;
    $('setup-welcome').hidden = details;
    $('setup-network').hidden = !details;
    if (details)
      $('setup-network').querySelector<HTMLElement>('h1')!.focus({ preventScroll: true });
    else $('show-setup-network').focus({ preventScroll: true });
  });
click('use-network', async () => {
  await call('configure', { genesis: candidate!.manifest.genesis });
  await render();
  onboarding('choice');
});
form('create-form', async () => {
  if (value('new-password') !== value('confirm-password')) {
    fieldFeedback('confirm-password', 'Your passwords do not match.');
    $('confirm-password').focus({ preventScroll: true });
    return;
  }
  message('');
  try {
    const v = await call<{ phrase: string }>('create', {
      password: value('new-password'),
    });
    await render();
    showPhrase(v.phrase);
    message('');
  } finally {
    clearSecrets();
  }
});
form('import-form', async () => {
  if (onboardingScreen !== 'import-password') return;
  message('');
  try {
    await call('import', {
      password: value('import-password'),
      phrase: value('import-phrase'),
    });
    clearSecrets();
    await render();
    message('Wallet imported.', false, true);
    await balances();
  } catch (error) {
    $<HTMLInputElement>('import-password').value = '';
    throw error;
  }
});
form('restore-form', async () => {
  if (onboardingScreen !== 'restore-password') return;
  message('');
  try {
    await call('restore', {
      password: value('restore-password'),
      backup: await readBackup(),
    });
    clearSecrets();
    $<HTMLInputElement>('backup-file').value = '';
    await render();
    message('Wallet restored from backup.', false, true);
    await balances();
  } catch (error) {
    $<HTMLInputElement>('restore-password').value = '';
    if (
      error instanceof Error &&
      (error.message === VAULT_PASSWORD_ERROR ||
        error.message ===
          'Cannot unlock: incorrect password, damaged backup or incompatible identity')
    ) {
      fieldFeedback(
        'restore-password',
        'Could not unlock. Check the password or try another backup.',
      );
      $('restore-password').focus({ preventScroll: true });
      return;
    }
    throw error;
  }
});
function unlockFeedback(error = '') {
  $('password-error').textContent = error;
  if (error) nudge($('password').closest('.input-wrap') ?? $('password'));
  if (error) $('password').setAttribute('aria-invalid', 'true');
  else $('password').removeAttribute('aria-invalid');
}
$('password').addEventListener('input', () => unlockFeedback());
$('password').addEventListener('invalid', (event) => {
  event.preventDefault();
  unlockFeedback(value('password') ? 'Use at least 6 characters.' : 'Enter your password.');
  $('password').focus({ preventScroll: true });
});
form('unlock-form', async () => {
  message('');
  unlockFeedback();
  try {
    try {
      await call('unlock', { password: value('password') });
    } finally {
      clearSecrets();
    }
  } catch (error) {
    if (error instanceof Error && error.message === VAULT_PASSWORD_ERROR) {
      unlockFeedback('Incorrect password or damaged backup.');
      $('password').focus({ preventScroll: true });
      return;
    }
    throw error;
  }
  watchOnly = false;
  await render();
  if (!requestId && state?.unlocked) await balances();
  if (state?.unlockSetup) $('password').focus({ preventScroll: true });
});
click('acknowledge', async () => {
  if (recoveryPage !== recoveryPages + 1 || !$<HTMLInputElement>('saved-phrase').checked)
    throw Error('Confirm that you saved the phrase.');
  await call('ack');
  $('phrase').textContent = '';
  $('recovery').hidden = true;
  await render();
  message('Backup confirmed. Your wallet is ready.', false, true);
  await balances();
});
click('lock', async () => {
  closePanel('settings-panel');
  await call('lock');
  watchOnly = false;
  $('phrase').textContent = '';
  $('recovery').hidden = true;
  clearSecrets();
  await render();
  message('Wallet locked. Your keys are encrypted on this device.', false, true);
});
click('refresh', async () => {
  await render();
  await balances();
  // A refresh that changes nothing still answers: the timestamp lights up.
  flash($('sync-state'), 'up');
  $('sync-state').textContent = 'Up to date · ' + $('sync-state').textContent;
});
click('retry-wallet-network', async () => {
  await balances();
  message('Connection restored.', false, true);
});
$('reload-extension').addEventListener('click', () => {
  if (busy) return;
  browser.runtime.reload?.();
});
let networkInspection = 0;
$('inspect-network').addEventListener('click', async () => {
  const expanded = $('connection-details').hidden;
  $('connection-details').hidden = !expanded;
  $('inspect-network').setAttribute('aria-expanded', String(expanded));
  if (expanded) await inspectConnection();
});
async function inspectConnection(recover = false) {
  const inspection = ++networkInspection;
  $('connection-diagnosis').textContent = 'Checking the connection to Quantus…';
  let phase = 'Network verification';
  try {
    const result = await call<{
      saved: Manifest | null;
      current: Manifest;
      matches: boolean;
    }>('network-diagnostics');
    if (inspection !== networkInspection || $('network-help').hidden) return;
    phase = 'Reading network details';
    const { saved, current, matches } = result;
    const differentChain = saved?.genesis !== current.genesis;
    $('connection-diagnosis').textContent = matches
      ? 'The network now matches. Use Retry connection to reload your balances.'
      : differentChain
        ? MAINNET_BUILD ? 'The services report a different chain. Sending stays paused until they serve Quantus mainnet again.'
          : TESTNET
            ? 'The services report a different test chain. Sending stays paused until they serve the saved one again.'
            : 'This is a different development chain. Restart the original local chain to use this wallet’s balances.'
        : 'The chain matches, but its runtime, activation or network format differs. Restore the saved configuration before sending.';
    $('message').textContent = matches
      ? 'The saved network is available again.'
      : differentChain
        ? MAINNET_BUILD || TESTNET ? 'A different network is connected. Sending is paused.' : 'A different development network is running. Sending is paused.'
        : 'The network configuration has changed. Sending is paused.';
    pairs('connection-values', [
      ['Saved genesis', saved?.genesis ?? 'Not configured'],
      ['Connected genesis', current.genesis],
      ['Saved runtime', saved?.runtimeHash ?? 'Not configured'],
      ['Connected runtime', current.runtimeHash],
      [
        'Saved activation',
        saved?.activation
          ? `${saved.activation.height} · ${saved.activation.hash}`
          : 'Not recorded',
      ],
      ['Connected activation', `${current.activation.height} · ${current.activation.hash}`],
      ['Node', state?.rpc ?? ''],
      ['Service', state?.api ?? ''],
      ['Interface version', VERSION],
      ['Background version', state?.backgroundVersion ?? 'Not reported'],
    ]);
    if (matches && recover && !requestId) {
      // A second pinned check inside balances must succeed before clearing the
      // warning. Never replace the saved manifest or touch encrypted key data.
      phase = 'Balance refresh';
      await balances();
      if (inspection === networkInspection) message('');
    }
  } catch (error) {
    if (inspection === networkInspection && !$('network-help').hidden) {
      const reason = uiError(error);
      $('message').textContent = reason;
      $('connection-diagnosis').textContent = `${phase} failed: ${reason}`;
    }
  }
}
click('copy-address', async () => {
  await copyText($('copy-address'), state!.account!.address);
});
function saveFile(content: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadBackup(v: unknown, owner: string) {
  saveFile(JSON.stringify(v, null, 2), 'application/json', `qlyphs-wallet-${owner.slice(2, 10)}.json`);
}
// Plain-text copy of the words on screen, at the user's request. The file is as sensitive as the
// words themselves, so it carries its own warning and the UI asks to move it offline.
click('download-words', async () => {
  const words = [...$('phrase').children].map((word) => word.textContent!.trim());
  const account = state?.account;
  const text = [
    'Qlyphs Wallet recovery words',
    ...(account ? [`Address: ${account.address}`] : []),
    '',
    ...words.map((word, i) => `${String(i + 1).padStart(2, ' ')}. ${word}`),
    '',
    'Anyone with these words controls this wallet and its funds.',
    'Keep this file offline: move it to a USB drive or print it, then delete it from',
    'this computer, its trash and any cloud folder. Qlyphs never asks for these words.',
    '',
  ].join('\n');
  saveFile(text, 'text/plain', `qlyphs-recovery-words${account ? '-' + account.owner.slice(2, 10) : ''}.txt`);
  message('Words downloaded. Move the file offline, then delete it from this computer.', false, true);
});
click('export', async () => {
  const owner = state!.account!.owner;
  const v = await call('backup');
  downloadBackup(v, owner);
  message('Backup downloaded. Keep it and its password in separate places.', false, true);
});
$('open-reset').addEventListener('click', () => {
  if (busy || $('open-reset').hidden) return;
  resetOwner = state?.account?.owner;
  resetBackupSaved = false;
  $<HTMLInputElement>('reset-confirm').checked = false;
  $('reset-error').textContent = '';
  delete $('reset-error').dataset.tone;
  clearSecrets();
  syncControls();
  $<HTMLDialogElement>('reset-dialog').showModal();
  $('cancel-reset').focus();
});
$('reset-confirm').addEventListener('change', syncControls);
$('cancel-reset').addEventListener('click', () => {
  if (!busy) $<HTMLDialogElement>('reset-dialog').close();
});
$('reset-dialog').addEventListener('cancel', (event) => {
  if (busy) event.preventDefault();
});
$('reset-dialog').addEventListener('close', () => {
  resetOwner = undefined;
  resetBackupSaved = false;
  $<HTMLInputElement>('reset-confirm').checked = false;
});
click('reset-backup', async () => {
  try {
    if (!resetOwner || resetOwner !== state?.account?.owner) return;
    const owner = resetOwner;
    const v = await call('locked-backup');
    downloadBackup(v, owner);
    resetBackupSaved = true;
    $('reset-error').textContent = 'Backup downloaded. You can now start a new wallet.';
    $('reset-error').dataset.tone = 'ok';
  } catch (error) {
    delete $('reset-error').dataset.tone;
    $('reset-error').textContent = uiError(error);
    nudge($('reset-error'));
  }
});
click('confirm-reset', async () => {
  if (
    !resetBackupSaved ||
    !$<HTMLInputElement>('reset-confirm').checked ||
    !resetOwner ||
    resetOwner !== state?.account?.owner
  )
    return;
  try {
    await call('wallet-reset', { confirmation: 'START_NEW_WALLET' });
    $<HTMLDialogElement>('reset-dialog').close();
    watchOnly = false;
    clearSecrets();
    await render();
    // Restore with a recovery phrase or a backup, or start a new wallet.
    onboarding('choice');
  } catch (error) {
    $('reset-error').textContent = uiError(error);
  }
});
form('reveal-form', async () => {
  try {
    showPhrase(await call<string>('recovery', { password: value('reveal-password') }));
    message('Hide your screen from others.');
  } finally {
    clearSecrets();
  }
});
function transferFeedback(id: string, error = '') {
  $(id + '-error').textContent = error;
  if (error) $(id).setAttribute('aria-invalid', 'true');
  else $(id).removeAttribute('aria-invalid');
}
function clearTransferFeedback() {
  for (const id of ['send-to', 'send-amount']) transferFeedback(id);
}
for (const id of ['send-to', 'send-amount']) {
  $(id).addEventListener('input', () => transferFeedback(id));
}
function transferFields(prefix: 'send', decimals: number, available?: bigint) {
  let to: string | undefined;
  let amount: bigint | undefined;
  transferFeedback(prefix + '-to');
  transferFeedback(prefix + '-amount');
  try {
    to = recipient(value(prefix + '-to').trim());
  } catch {
    transferFeedback(
      prefix + '-to',
      value(prefix + '-to').trim() ? 'Enter a valid address.' : 'Enter a recipient.',
    );
  }
  try {
    amount = parseUnits(value(prefix + '-amount').trim(), decimals);
    if (amount <= 0n) {
      transferFeedback(prefix + '-amount', 'Enter more than zero.');
      amount = undefined;
    } else if (available !== undefined && amount > available) {
      const locked =
        decimals === 12 && value('send-asset') === 'qtc' && balanceView
          ? incomingBalance(balanceView.balance)
          : 0n;
      transferFeedback(
        prefix + '-amount',
        locked && amount <= available + locked
          ? 'Part of this is still locked until final.'
          : 'Amount exceeds available balance.',
      );
      amount = undefined;
    }
  } catch {
    transferFeedback(
      prefix + '-amount',
      value(prefix + '-amount').trim()
        ? `Use up to ${decimals} decimal places.`
        : 'Enter an amount.',
    );
  }
  if (to === undefined || amount === undefined) {
    if (to === undefined) nudge($(prefix + '-to'));
    if (amount === undefined) nudge($(prefix + '-amount').closest('.amount-input'));
    $(prefix + (to === undefined ? '-to' : '-amount')).focus();
    return;
  }
  return { to, amount: amount.toString() };
}
form('send-form', async () => {
  requireSigning();
  const id = value('send-asset');
  const native = id === 'qtc';
  const asset = assets.find((a) => a.id === id && BigInt(a.available) > 0n);
  if (!native && !asset) throw Error('This asset is unavailable. Select another asset or refresh.');
  if (native && freeBalance === undefined) throw Error('Refresh your balance before sending.');
  const fields = transferFields(
    'send',
    native ? 12 : asset!.definition.decimals,
    native ? freeBalance : BigInt(asset!.available),
  );
  if (!fields) return;
  const opened = await call<{ request?: string }>('transact', {
    command: native ? { kind: 'sendQtc', ...fields } : { kind: 'transfer', asset: id, ...fields },
  });
  awaitingRequest = opened?.request;
  cancelledUntil = 0;
  $<HTMLInputElement>('send-to').value = '';
  $<HTMLInputElement>('send-amount').value = '';
  paintRecipientName();
  $<HTMLDetailsElement>('send-panel').open = false;
  awaitingSince = Date.now();
  awaitingAmount = formatUnits(BigInt(fields.amount), native ? 12 : asset!.definition.decimals) +
    ' ' + (native ? 'QTC' : ownName(asset!));
  trackedHash = undefined;
  trackerUntil = 0;
  paintTracker(balanceView?.transactions ?? state?.transactions ?? []);
});
$('tx-tracker').addEventListener('click', () => {
  const hash = $('tx-tracker').dataset.hash;
  selectTab($<HTMLButtonElement>('tab-activity'), true);
  if (!hash) return;
  $('history').querySelector(`[data-hash="${hash}"]`)?.scrollIntoView({ block: 'nearest' });
  openTxSheet(hash);
});
/** Rejecting only removes authority, so it always leaves: a request the wallet already cancelled
 * (the site's page changed, the wallet locked) has nothing left to refuse. */
async function rejectRequest() {
  try {
    await call('reject', { id: requestId });
  } catch {
    // Already answered or cancelled.
  }
  leave();
}
click('reject', rejectRequest);
click('cancel-unlock', rejectRequest);
/** A new tip prepares the lot again in the background: a new review and digest, then a re-render
 * whose total glows in the direction it moved. */
const tipPicker = mountTipPicker($<HTMLDialogElement>('fee-sheet'), (tip) => {
  const before = pending?.review?.tip ?? pending?.session?.tip ?? '0';
  void task(async () => {
    tipPicker.pending(true);
    try {
      await call('review-tip', { id: requestId, tip });
      await render();
      const total = document.querySelector('#review-summary :is(.review-total, .review-strong) dd');
      flash(total, BigInt(tip) > BigInt(before) ? 'down' : 'up');
    } catch (error) {
      tipPicker.show(before);
      throw error;
    } finally {
      tipPicker.pending(false);
    }
  });
});
click('approve', async () => {
  const review = pending;
  if (!review || Date.now() >= review.expires) throw Error('No valid review to approve');
  // A consumed/failed review cannot be clicked a second time from a stale popup.
  pending = undefined;
  if (review.kind === 'session') return startSession(review);
  if (review.kind === 'vault') {
    await call('approve', { id: requestId, digest: review.digest });
    // The signature went back to the site: say so on the button for a beat, then step aside.
    $('approve').textContent = 'Signed';
    pop($('approve'));
    // A side panel returns to its home view; a window closes.
    setTimeout(leave, SENT_CLOSE_MS);
    return;
  }
  if (review.kind !== 'transaction') {
    await call('approve', { id: requestId, digest: review.digest });
    leave();
    return;
  }
  const c = review.review!.command;
  const transfer = c.kind === 'sendQtc' || (c.kind === 'transfer' && review.review!.asset);
  sent = {
    stage: 'signing',
    label: labels[String(c.kind)] ?? 'Transaction',
    ...(transfer
      ? {
          amount: String(c.amount),
          to: String(c.to),
          symbol: c.kind === 'sendQtc' ? 'QTC' : assetName(review.review!.asset!),
          decimals: c.kind === 'sendQtc' ? 12 : review.review!.asset!.definition.decimals,
        }
      : {}),
  };
  paintResult(true);
  try {
    const result = await call<{ hash: string; status: string }>('approve', {
      id: requestId,
      digest: review.digest,
    });
    sent.hash = result.hash;
    sent.tx = { hash: result.hash, label: String(c.kind), status: result.status };
    sent.stage = 'sent';
  } catch (e) {
    sent.stage = 'failed';
    sent.error = e instanceof Error ? e.message : 'Operation cancelled or verification failed';
  }
  message('');
  paintResult();
  // In Qlyphs Keys the review is a frame over the site's popup: once the network has the
  // transaction, the site shows its progress, so the window steps aside after a beat.
  if (window.top !== window && sent.stage === 'sent') setTimeout(() => window.close(), SENT_CLOSE_MS);
});
click('tx-result-done', async () => leave());
click('tx-result-explorer', async () => {
  if (sent?.hash) await openExplorer(sent.hash);
});
click('tx-result-hash', async () => {
  if (sent?.hash) await copyText($('tx-result-hash'), sent.hash);
});
click('mint-session-hash', async () => {
  if (shownSession?.hash) await copyText($('mint-session-hash'), shownSession.hash);
});
function requireSigning() {
  if (!state?.unlocked) {
    watchOnly = false;
    syncViews();
    $('password').focus();
    throw Error('Unlock your wallet before sending.');
  }
  if (!state.backed)
    throw Error('Save your recovery phrase before sending. You can reveal it in Settings.');
}
// View changes are local. Background approval still owns all signing operations.
const panels = ['send-panel', 'receive-panel', 'token-panel', 'collection-panel', 'settings-panel'];
/** What gets focus back when a screen closes, and the screen it was opened from. */
const panelReturn = new Map<string, { trigger: HTMLElement; parent?: string }>();
function openPanel(id: string, trigger?: HTMLElement) {
  const parent = panels.find((p) => p !== id && $<HTMLDetailsElement>(p).open);
  const back = panelReturn.get(id);
  panelReturn.set(id, {
    trigger: trigger ?? back?.trigger ?? $('open-accounts'),
    parent: parent && trigger && $(parent).contains(trigger) ? parent : undefined,
  });
  $('wallet').scrollTop = 0;
  for (const p of panels) $<HTMLDetailsElement>(p).open = p === id;
  $(id).scrollTop = 0;
  $(id)
    .querySelectorAll('.flow-content, .flow-shell')
    .forEach((content) => content.scrollTo(0, 0));
  motion.reveal($(id), pointerInput, true);
  requestAnimationFrame(
    () =>
      $<HTMLDetailsElement>(id).open &&
      $<HTMLDetailsElement>(id)
        .querySelector<HTMLElement>(id === 'settings-panel' ? '.settings-title' : 'input,select,button:not(summary *)')
        ?.focus({ preventScroll: true }),
  );
}
function closePanel(id: string) {
  $<HTMLDetailsElement>(id).open = false;
}
for (const id of panels)
  $<HTMLDetailsElement>(id).addEventListener('toggle', () => {
    if ($<HTMLDetailsElement>(id).open || panels.some((p) => $<HTMLDetailsElement>(p).open)) return;
    for (const setting of $(id).querySelectorAll<HTMLDetailsElement>('details.setting[open]'))
      setting.open = false;
    const back = panelReturn.get(id);
    if (back?.parent) {
      $<HTMLDetailsElement>(back.parent).open = true;
      back.trigger.focus({ preventScroll: true });
      return;
    }
    motion.cancel();
    (back?.trigger?.isConnected ? back.trigger : $('tab-tokens')).focus({ preventScroll: true });
  });
$('show-send').addEventListener('click', () => openSend());
async function showReceive(trigger: HTMLElement) {
  if (!state?.account) return;
  await QRCode.toCanvas($<HTMLCanvasElement>('receive-qr'), state.account.address, {
    width: 240,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#0e0e0e', light: '#ffffff' },
  });
  // Keep the encoded bitmap intact; CSS owns the displayed size for each surface.
  $('receive-qr').style.removeProperty('width');
  $('receive-qr').style.removeProperty('height');
  openPanel('receive-panel', trigger);
}
click('show-receive', () => showReceive($('show-receive')));
click('copy-receive', async () => {
  await copyText($('copy-receive'), state!.account!.address);
});
click('retry-network', render);
$('saved-phrase').addEventListener('change', syncControls);
$('send-asset').addEventListener('change', changeSendAsset);
$('return-unlock').addEventListener('click', () => {
  watchOnly = false;
  syncViews();
  $('unlock').scrollTop = 0;
  $('password').focus();
});
$('hide-balance').addEventListener('click', () => {
  privateBalances = !privateBalances;
  $('hide-balance').setAttribute('aria-label', privateBalances ? 'Show balances' : 'Hide balances');
  $('hide-balance').setAttribute('aria-pressed', String(privateBalances));
  $('hide-balance').querySelector('use')!.setAttribute('href', privateBalances ? '#i-eye-off' : '#i-eye');
  paintBalances();
});
for (const id of Object.keys(onboardingHints)) {
  const input = $<HTMLInputElement | HTMLTextAreaElement>(id);
  input.addEventListener('input', () => {
    fieldFeedback(id);
    if (id === 'new-password') fieldFeedback('confirm-password');
    if (id === 'import-phrase') phraseCount();
  });
  input.addEventListener('invalid', (event) => {
    // Inline feedback stays inside the screen, without an overlapping browser bubble.
    event.preventDefault();
    fieldFeedback(
      id,
      id === 'backup-file'
        ? 'Choose your encrypted Qlyphs backup.'
        : id === 'import-phrase'
          ? 'Enter your recovery words to continue.'
          : input.validity.valueMissing
            ? 'Enter your password to continue.'
            : 'Use at least 6 characters.',
    );
    if (
      !input.form?.querySelector('[aria-invalid="true"]') ||
      input.form.querySelector('[aria-invalid="true"]') === input
    )
      input.focus({ preventScroll: true });
  });
}
$('backup-file').addEventListener('change', () => fieldFeedback('backup-file'));
$('new-password').addEventListener('input', () => {
  const length = value('new-password').length;
  if (!length) $('password-meter').removeAttribute('data-level');
  else $('password-meter').dataset.level = length >= 12 ? 'long' : length >= 6 ? 'valid' : 'short';
  $('password-hint').textContent =
    length >= 6 ? 'Minimum length met. Keep it unique.' : defaultHints['password-hint']!;
});
for (const toggle of document.querySelectorAll<HTMLButtonElement>('[data-password]'))
  toggle.addEventListener('click', () => {
    const input = $<HTMLInputElement>(toggle.dataset.password!),
      show = input.type === 'password';
    const start = input.selectionStart,
      end = input.selectionEnd;
    input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    toggle.setAttribute('aria-pressed', String(show));
    input.focus({ preventScroll: true });
    if (start !== null && end !== null) input.setSelectionRange(start, end);
  });
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.bottom-nav [role=tab]')];
function selectTab(tab: HTMLButtonElement, animate = false) {
  if (tab.getAttribute('aria-selected') === 'true') return;
  $('wallet').dataset.view = tab.dataset.tab!.replace('-tab', '');
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.dataset.tab!).hidden = !on;
  }
  $('wallet').scrollTop = 0;
  syncWalletScroll();
  motion.select(animate);
  motion.reveal($(tab.dataset.tab!), animate);
}
for (const tab of tabs) {
  tab.addEventListener('click', (event) => selectTab(tab, event.detail > 0));
  tab.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const visibleTabs = tabs.filter((item) => !item.hidden);
    const index =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? visibleTabs.length - 1
          : (visibleTabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1) + visibleTabs.length) %
            visibleTabs.length;
    const next = visibleTabs[index]!;
    selectTab(next);
    next.focus();
  });
}
$('backup-reminder').addEventListener('click', () => {
  openSettings($('backup-reminder'));
  $<HTMLDetailsElement>('reveal-panel').open = true;
  requestAnimationFrame(() => $('reveal-password').focus());
});
function openSettings(trigger: HTMLElement = $('open-accounts')) {
  $<HTMLDialogElement>('account-drawer').close();
  openPanel('settings-panel', trigger);
}
// Inside Settings, one page at a time: the pages share a details name, so opening one closes the
// one before.
// A page covers the list from its top: the list scrolls back up while it is open, and returns to
// where it was when the page closes.
let settingsScroll = 0;
for (const page of document.querySelectorAll<HTMLDetailsElement>('#settings-tab details.setting'))
  page.addEventListener('toggle', () => {
    const list = $('settings-tab');
    if (page.open) {
      if (list.scrollTop) settingsScroll = list.scrollTop;
      list.scrollTop = 0;
      page.scrollTop = 0;
    } else if (!list.querySelector('details.setting[open]')) {
      list.scrollTop = settingsScroll;
      settingsScroll = 0;
    }
  });

/* Home: tokens, then collectibles (collections and Quarks), small tabs under the actions. */
/* Collectibles: Collections and Quarks fold away, each remembered per browser, so a long list of
 * one does not push the other out of reach. */
const FOLDED_KEY = 'qlyphs-collectibles-folded';
for (const id of ['collections-block', 'quarks-block']) {
  const block = $<HTMLDetailsElement>(id);
  try {
    if ((JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]') as unknown[]).includes(id)) block.open = false;
  } catch {
    // Not remembered: the section starts open.
  }
  block.addEventListener('toggle', () => {
    try {
      const folded = ['collections-block', 'quarks-block'].filter((b) => !$<HTMLDetailsElement>(b).open);
      localStorage.setItem(FOLDED_KEY, JSON.stringify(folded));
    } catch {
      // Kept for this page only.
    }
  });
}
const homeTabs = [$<HTMLButtonElement>('home-tokens'), $<HTMLButtonElement>('home-collectibles')];
function selectHome(tab: HTMLButtonElement) {
  for (const t of homeTabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')!).hidden = !on;
  }
}
for (const tab of homeTabs) {
  tab.addEventListener('click', () => selectHome(tab));
  tab.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : homeTabs.length - 1;
    const next = homeTabs[(homeTabs.indexOf(tab) + step) % homeTabs.length]!;
    selectHome(next);
    next.focus();
  });
}

/* Account drawer: every account as an avatar, then add, manage and settings. */
const drawer = $<HTMLDialogElement>('account-drawer');
function paintDrawer() {
  const all = state?.accounts ?? [];
  $('drawer-accounts').replaceChildren(
    ...all.map((account) => {
      const selected = account.owner === state?.account?.owner;
      const button = node('button', '', 'drawer-account') as HTMLButtonElement;
      button.type = 'button';
      button.setAttribute('aria-label', account.name + (selected ? ', selected' : ''));
      if (selected) button.setAttribute('aria-current', 'true');
      const avatar = node('span', '', 'account-avatar');
      avatar.setAttribute('aria-hidden', 'true');
      paintAccountAvatar(avatar, account.owner);
      button.append(avatar, node('span', account.name, 'drawer-name'));
      button.addEventListener(
        'click',
        () =>
          void task(async () => {
            drawer.close();
            if (selected) return;
            await call('account-select', { owner: account.owner });
            await render();
            message(`Switched to ${account.name}.`, false, true);
            arrive($('open-accounts'));
            if (state?.unlocked) await balances();
          }, button),
      );
      return button;
    }),
  );
  const count = all.length;
  $<HTMLButtonElement>('drawer-add').disabled = busy || !state?.unlocked || !state.backed || count >= 20;
}
function openDrawer() {
  if (busy || requestId || drawer.open) return;
  paintDrawer();
  drawer.showModal();
  ($('drawer-accounts').querySelector<HTMLElement>('[aria-current]') ?? $('close-drawer')).focus({
    preventScroll: true,
  });
}
$('close-drawer').addEventListener('click', () => drawer.close());
drawer.addEventListener('click', (event) => {
  // A click on the dimmed page beside the rail closes the drawer.
  if (event.target === drawer) drawer.close();
});
drawer.addEventListener('close', () => {
  if (!document.querySelector('#wallet details.flow[open]') && !$<HTMLDialogElement>('accounts-dialog').open)
    $('open-accounts').focus({ preventScroll: true });
});
/* The drawer's +: another account from this wallet's recovery phrase. Another phrase means
 * another wallet: forget this one (Forgot password) and import or create it. */
$('drawer-add').addEventListener('click', () => {
  drawer.close();
  $('add-account').click();
});
$('drawer-edit').addEventListener('click', () => {
  drawer.close();
  showAccounts();
});
$('drawer-settings').addEventListener('click', () => openSettings());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.querySelector('dialog[open]')) return;
    const id = panels.find((p) => $<HTMLDetailsElement>(p).open);
    if (!id) return;
    // A settings page closes first, back to the settings list.
    const page = $(id).querySelector<HTMLDetailsElement>('details.setting[open]');
    if (page) {
      page.open = false;
      page.querySelector('summary')!.focus({ preventScroll: true });
      return;
    }
    closePanel(id);
  }
});
function syncPreferences() {
  $('expand-wallet').hidden = !['popup', 'sidebar'].includes(surface) || !$('recovery').hidden;
  $('display-settings').hidden = !state?.display?.sidebar;
  syncNetworkSwitch();
  for (const mode of ['sidebar', 'popup'])
    $('display-' + mode).setAttribute('aria-pressed', String(state?.display?.mode === mode));
  $('display-value').textContent = state?.display?.mode === 'popup' ? 'Popup' : 'Side panel';
  syncSurfaceToggle();
  $('sites-count').textContent = String(state?.sites?.length ?? 0);
  // Settings opens on the account it applies to.
  $('settings-account-name').textContent = state?.name ?? 'Account 1';
  $('settings-account-address').textContent = state?.account ? short(state.account.address) : '';
  if (state?.account) paintAccountAvatar($('settings-avatar'), state.account.owner);
  $('unlock-passkey').hidden = !state?.passkey || !!state?.unlockSetup;
  $('passkey-divider').hidden = !state?.passkey || !!state?.unlockSetup;
  $('passkey-tab-hint').hidden = !state?.passkey || !!state?.unlockSetup || surface !== 'popup';
  $('passkey-status').textContent = state?.passkey
    ? 'On · Linked for all wallets on this device'
    : 'Off · Your password unlocks the wallet';
  $('passkey-badge').textContent = state?.passkey ? 'On' : 'Off';
  $('manage-passkey').textContent = state?.passkey
    ? 'Manage in a dedicated tab'
    : 'Set up in a dedicated tab';
  $('passkey-in-popup').hidden = surface === 'tab';
  $('passkey-form').hidden = surface !== 'tab' || !!state?.passkey;
  $('remove-passkey-form').hidden = surface !== 'tab' || !state?.passkey;
  for (const id of ['passkey-password', 'remove-passkey-password'])
    $<HTMLInputElement>(id).disabled = busy || !state?.unlocked;
  $<HTMLButtonElement>('enroll-passkey').disabled = busy || !state?.unlocked || !state?.backed;
  $('remove-passkey-form').querySelector<HTMLButtonElement>('button')!.disabled =
    busy || !state?.unlocked;
  const n = state?.notifications,
    on = !!n?.enabled && !!n?.permitted;
  $('notification-toggle').setAttribute('aria-checked', String(on));
  $<HTMLButtonElement>('notification-toggle').disabled = busy || !n?.available;
  $('notification-status').textContent = n?.enabled && !n.permitted ? 'Paused' : on ? 'On' : 'Off';
  $('test-notification').hidden = !on;
}
async function openWalletTab(view?: string) {
  const url = new URL(browser.runtime.getURL('ui.html'));
  url.searchParams.set('surface', 'tab');
  if (view) url.searchParams.set('view', view);
  if (view === 'settings') url.searchParams.set('security', 'passkey');
  await browser.tabs.create({ url: url.href });
}
async function openExplorer(hash?: string) {
  await browser.tabs.create({ url: explorerURL(EXPLORER, hash) });
}
click('open-explorer', () => openExplorer());
click('expand-wallet', () => openWalletTab());
/** The header's popup ↔ side panel control. Chrome opens a side panel only inside the click, so
 * the window is known beforehand; the toolbar icon then keeps opening the chosen surface. */
const sidePanel = browser.sidePanel;
let windowId: number | undefined;
if (sidePanel && surface === 'popup')
  void browser.windows.getCurrent?.().then((w) => (windowId = w.id)).catch(() => undefined);
/** The user is in the middle of something a site's request must not throw away: an operation, a
 * send or settings screen, a dialog, or a password being typed. The request waits for its popup. */
function inputInProgress() {
  return (
    busy ||
    $<HTMLDetailsElement>('send-panel').open ||
    $<HTMLDetailsElement>('settings-panel').open ||
    !!document.querySelector('dialog[open]') ||
    (!$('unlock').hidden && !!value('password'))
  );
}
/** The side panel's channel to the background: on its home view it takes a site's request (unless
 * the recovery phrase or onboarding is on screen); on a request it keeps the review alive. */
if (sidePanel && (surface === 'sidebar' || inPanel)) {
  const port = browser.runtime.connect({ name: 'qlyphs-panel' });
  void browser.windows.getCurrent?.()
    .then((w) => port.postMessage({ window: w.id }))
    .catch(() => undefined);
  port.onMessage.addListener((message) => {
    const m = message as { action?: unknown; request?: unknown; key?: unknown };
    if (inPanel && typeof m?.key === 'string') return resolvePanelKey(m.key);
    if (m?.action !== 'open-request' || typeof m.request !== 'string' || !/^[0-9a-f-]{36}$/.test(m.request))
      return;
    const free =
      !requestId && !!state?.account && $('recovery').hidden && (!$('wallet').hidden || !$('unlock').hidden) &&
      !inputInProgress();
    port.postMessage({ accepted: free });
    if (free)
      location.replace(
        browser.runtime.getURL('ui.html?surface=sidebar&request=' + encodeURIComponent(m.request)),
      );
  });
}
function syncSurfaceToggle() {
  const toggle = $('toggle-surface');
  toggle.hidden =
    !state?.display?.sidebar || !['popup', 'sidebar'].includes(surface) || !state?.account || !$('recovery').hidden;
  const label = surface === 'sidebar' ? 'Open as popup' : 'Open in side panel';
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
}
$('toggle-surface').addEventListener('click', () => {
  if (busy) return;
  if (surface === 'popup') {
    if (windowId === undefined || !sidePanel) return;
    // Opened first, synchronously in the gesture; the preference follows.
    void sidePanel
      .open({ windowId })
      .then(() => call('display-mode', { mode: 'sidebar' }))
      .then(() => window.close())
      .catch((error: Error) => message(error.message || 'The side panel could not open.', true));
    return;
  }
  void call('display-mode', { mode: 'popup' })
    .then(() => browser.action?.openPopup?.())
    .catch(() => undefined)
    .finally(() => window.close());
});
for (const mode of ['sidebar', 'popup'])
  click('display-' + mode, async () => {
    await call('display-mode', { mode });
    state = await call<UIState>('status');
    syncPreferences();
    message(
      mode === 'sidebar'
        ? 'The toolbar icon now opens the side panel.'
        : 'The toolbar icon now opens a popup.',
      false,
      true,
    );
  });
/** The network switch (switchable builds): in Settings, on the welcome screen and next to a
 * connection error, so a wallet is never stuck on a network it cannot reach. */
/** Test networks stay out of the way until asked for, as other wallets do. Per browser. */
const SHOW_TEST_KEY = 'qlyphs.showTestNetworks';
let showTestNetworks = (() => {
  try {
    return localStorage.getItem(SHOW_TEST_KEY) === '1';
  } catch {
    return false;
  }
})();
$('show-tx-details').setAttribute('aria-checked', String(showDetails));
$('show-tx-details').addEventListener('click', () => {
  showDetails = !showDetails;
  try {
    localStorage.setItem(DETAILS_KEY, showDetails ? '1' : '0');
  } catch {
    // Not remembered: the choice holds for this page.
  }
  $('show-tx-details').setAttribute('aria-checked', String(showDetails));
});
$('show-prices').setAttribute('aria-checked', String(showPrices));
$('show-prices').addEventListener('click', () => {
  showPrices = !showPrices;
  try {
    localStorage.setItem(PRICES_KEY, showPrices ? '1' : '0');
  } catch {
    // Not remembered: the choice holds for this page.
  }
  $('show-prices').setAttribute('aria-checked', String(showPrices));
  if (!showPrices) {
    qtcUsd = undefined;
    qtcCharts.clear();
  }
  paintBalances();
  if ($<HTMLDetailsElement>('token-panel').open) paintToken();
  void loadQtcPrice();
});
/* Clear activity: finished operations leave this browser's history after a confirmation; the
 * background keeps those still in progress and those a mint session counts on. */
const FINISHED = ['finalized', 'expired', 'cancelled-before-broadcast'];
const clearDialog = $<HTMLDialogElement>('clear-dialog');
/** Called from resetAccountView, which may run before `clearDialog` is set. */
function closeClearActivity() {
  const dialog = $<HTMLDialogElement>('clear-dialog');
  if (dialog.open) dialog.close();
}
$('clear-activity').addEventListener('click', () => {
  const finished = history.filter((tx) => FINISHED.includes(tx.status)).length;
  if (!finished) {
    message('No finished operations to clear.', false, true);
    return;
  }
  $('clear-text').textContent = `This removes ${finished} finished operation${finished === 1 ? '' : 's'} of ${
    state?.name ?? 'this account'
  } from this browser.`;
  clearDialog.showModal();
  $('cancel-clear-activity').focus();
});
clearDialog.addEventListener('close', () => $('clear-activity').focus({ preventScroll: true }));
clearDialog.addEventListener('click', (event) => {
  if (event.target === clearDialog) clearDialog.close();
});
$('cancel-clear-activity').addEventListener('click', () => clearDialog.close());
onClick('confirm-clear-activity', async () => {
  const { removed } = await call<{ removed: number }>('clear-history');
  clearDialog.close();
  seenActivity.clear();
  message(removed ? `Cleared ${removed} operation${removed === 1 ? '' : 's'}.` : 'Nothing to clear.', false, true);
  await balances(true);
});
$('show-test-networks').addEventListener('click', () => {
  showTestNetworks = !showTestNetworks;
  try {
    localStorage.setItem(SHOW_TEST_KEY, showTestNetworks ? '1' : '0');
  } catch {
    // Not remembered: the choice holds for this page.
  }
  syncNetworkSwitch();
});
function paintEndpoints() {
  const e = state?.endpoints;
  const test = state?.network?.active === 'development' || (!state?.network?.switchable && !MAINNET_BUILD);
  $('network-settings').hidden = !e;
  if (!e) return;
  const tag = (key: keyof Endpoints) => (e.custom[key] ? ' · Custom' : '');
  pairs('endpoint-rows', [
    ['Node' + tag('rpc'), e.rpc],
    ...(test
      ? ([
          ['Indexer' + tag('api'), e.api],
          ['Explorer' + tag('explorer'), e.explorer],
        ] as [string, string][])
      : []),
  ]);
  $('edit-endpoints').hidden = !e.editable || !$('endpoints-form').hidden;
  $('endpoint-api-field').hidden = !test;
  $('endpoint-explorer-field').hidden = !test;
  $('reset-endpoints').hidden = !Object.keys(e.custom).length;
}
function fillEndpoints(values: { rpc: string; api: string; explorer: string }) {
  $<HTMLInputElement>('endpoint-rpc').value = values.rpc;
  $<HTMLInputElement>('endpoint-api').value = values.api;
  $<HTMLInputElement>('endpoint-explorer').value = values.explorer;
}
const endpointsHint = $('endpoints-hint').textContent!.trim();
function endpointsFeedback(text = endpointsHint, error = false) {
  $('endpoints-hint').textContent = text;
  $('endpoints-hint').classList.toggle('field-error', error);
}
$('edit-endpoints').addEventListener('click', () => {
  const e = state?.endpoints;
  if (!e) return;
  fillEndpoints(e);
  endpointsFeedback();
  $('endpoints-form').hidden = false;
  $('edit-endpoints').hidden = true;
  $('endpoint-rpc').focus();
});
$('cancel-endpoints').addEventListener('click', () => {
  $('endpoints-form').hidden = true;
  endpointsFeedback();
  paintEndpoints();
  $('edit-endpoints').focus();
});
/** Save new endpoints: the browser's consent first (inside the click), then the wallet proves them. */
function saveEndpoints(endpoints: Endpoints | null, trigger: HTMLElement) {
  const name = state?.network?.active ?? (MAINNET_BUILD ? 'mainnet' : 'development');
  let hosts: string[] = [];
  try {
    if (endpoints) hosts = hostPatterns(checkEndpoints(name, endpoints, LOCAL_NETWORK));
  } catch (error) {
    endpointsFeedback((error as Error).message, true);
    return;
  }
  const consent = hosts.length
    ? (browser.permissions?.request({ origins: hosts }) ?? Promise.resolve(false))
    : Promise.resolve(true);
  void task(async () => {
    if (!(await consent)) {
      endpointsFeedback('Qlyphs needs your permission to reach this address.', true);
      return;
    }
    try {
      await call('set-endpoints', { network: name, endpoints });
    } catch (error) {
      endpointsFeedback(uiError(error), true);
      return;
    }
    await reloadEndpoints();
    $('endpoints-form').hidden = true;
    endpointsFeedback();
    resetNetworkView();
    await render();
    // Back where the change was made: the network page, now showing the new endpoints.
    if (!$('wallet').hidden) {
      openSettings();
      $<HTMLDetailsElement>('network-settings').open = true;
    }
    if (state?.unlocked) await balances(true);
    message(endpoints ? 'Network endpoints updated.' : 'Default endpoints restored.', false, true);
  }, trigger);
}
$('endpoints-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const e = state?.endpoints;
  if (!e) return;
  const test = !$('endpoint-api-field').hidden;
  // Only what differs from the compiled endpoints is stored: the rest follows the build.
  const entered: Endpoints = {};
  const rpc = value('endpoint-rpc').trim(),
    api = value('endpoint-api').trim(),
    explorer = value('endpoint-explorer').trim();
  if (rpc && rpc !== e.defaults.rpc) entered.rpc = rpc;
  if (test && api && api !== e.defaults.api) entered.api = api;
  if (test && explorer && explorer !== e.defaults.explorer) entered.explorer = explorer;
  saveEndpoints(Object.keys(entered).length ? entered : null, (event as SubmitEvent).submitter as HTMLElement);
});
$('reset-endpoints').addEventListener('click', () => saveEndpoints(null, $('reset-endpoints')));
function syncNetworkSwitch() {
  const switchable = !!state?.network?.switchable;
  $('network-choices').hidden = !switchable;
  const testActive = state?.network?.active === 'development';
  $('choice-test-network').hidden = !showTestNetworks && !testActive;
  $('show-test-networks').setAttribute('aria-checked', String(showTestNetworks || testActive));
  $<HTMLButtonElement>('show-test-networks').disabled = testActive;
  paintEndpoints();
  for (const label of document.querySelectorAll<HTMLElement>('[data-network-name]'))
    label.textContent =
      state?.network?.active === 'mainnet' ? 'Quantus Mainnet' : TESTNET ? 'Quantus Testnet' : 'Quantus Devnet';
  // Outside Settings the test network is offered only once test networks are shown.
  for (const group of document.querySelectorAll<HTMLElement>('[data-network-switch]'))
    group.hidden = !switchable || (!showTestNetworks && !testActive);
  $('network-value').textContent =
    state?.network?.active === 'mainnet' ? 'Mainnet' : TESTNET ? 'Testnet' : 'Development';
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-switch-network]')) {
    button.setAttribute('aria-pressed', String(state?.network?.active === button.dataset.switchNetwork));
    button.disabled = busy;
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-switch-network]'))
  button.addEventListener('click', () => {
    const name = button.dataset.switchNetwork as 'mainnet' | 'development';
    if (state?.network?.active === name) return;
    // Busy for the whole switch: the status polls pause, so the page never paints the wallet
    // half-way (no account while the background moves to the other network's pin).
    void task(async () => {
      message(
        `Switching to ${name === 'mainnet' ? 'Quantus mainnet' : TESTNET ? 'the test network' : 'the development network'}…`,
        false,
        true,
      );
      try {
        await call('switch-network', { network: name });
      } catch (error) {
        message(uiError(error), true);
        return;
      }
      await followNetwork(name);
      message(`Now on ${name === 'mainnet' ? 'Quantus mainnet' : TESTNET ? 'the test network' : 'the development network'}.`, false, true);
    }, button);
  });
click('manage-passkey', () => openWalletTab('settings'));
async function usePasskey(enroll: boolean) {
  if (surface !== 'tab') {
    await openWalletTab();
    return;
  }
  passkeyAbort = new AbortController();
  let prf: Uint8Array | undefined;
  try {
    message(
      enroll
        ? 'Follow your device’s prompts to create and verify your passkey.'
        : 'Confirm your passkey on your device.',
    );
    const challenge = await call<PasskeyChallenge>('passkey-begin', {
      mode: enroll ? 'enroll' : 'unlock',
    });
    const credential = await passkeyPRF(challenge, enroll, passkeyAbort.signal);
    prf = credential.prf;
    await call('passkey-complete', {
      id: challenge.id,
      credentialId: credential.credentialId,
      prf: hex(prf),
      password: enroll ? value('passkey-password') : '',
    });
    watchOnly = false;
    await render();
    if (!enroll && state?.unlocked) await balances();
    message(
      enroll
        ? 'Passkey linked. Your password and recovery phrase still work.'
        : state?.unlockSetup
          ? 'Enter each old password once to finish linking your wallets.'
          : 'All wallets unlocked with your passkey.',
      false,
      true,
    );
  } catch (e) {
    throw passkeyError(e);
  } finally {
    prf?.fill(0);
    passkeyAbort = undefined;
    clearSecrets();
  }
}
click('unlock-passkey', () => usePasskey(false));
form('passkey-form', () => usePasskey(true));
form('remove-passkey-form', async () => {
  try {
    await call('passkey-remove', {
      password: value('remove-passkey-password'),
    });
    await render();
    message('Passkey unlock removed from Qlyphs.', false, true);
  } finally {
    clearSecrets();
  }
});
$('notification-toggle').addEventListener('click', () => {
  if (busy) return;
  const enabling = !(state?.notifications?.enabled && state.notifications.permitted);
  // Request permission synchronously in the click gesture, before any message/await.
  const consent = enabling
    ? browser.permissions?.request({ permissions: ['notifications'] })
    : Promise.resolve(true);
  void task(async () => {
    if (!(await consent)) {
      message('Notifications remain off. You can enable them whenever you like.');
      return;
    }
    await call('notifications', { enabled: enabling });
    await render();
    message(
      enabling ? 'Desktop notifications enabled.' : 'Desktop notifications turned off.',
      false,
      true,
    );
  });
});
click('test-notification', async () => {
  await call('notification-test');
  message(
    'Test requested. Check Chrome and your system’s notification settings if it does not appear.',
    false,
    true,
  );
});
window.addEventListener('pagehide', () => {
  // Best effort: closing the window and the lease stop signing anyway. Sent while the approval is
  // still being saved, it cancels that approval before its session starts.
  if (requestId && (sessionStarting || (minting && minting.state !== 'ended')))
    void Promise.resolve()
      .then(() =>
        browser.runtime.sendMessage({
          action: 'session-leave',
          request: requestId,
          page: PAGE,
          ...(panelKeyValue ? { panelKey: panelKeyValue } : {}),
        }),
      )
      .catch(() => undefined);
  for (const restore of copyTimers.values()) restore();
  passkeyAbort?.abort();
  clearSecrets();
  $('phrase').textContent = '';
});
onboarding('choice', false);
void task(async () => {
  await render();
  if (!requestId && state?.account) await balances();
  const tab = params.get('view');
  if (tab === 'activity' || tab === 'explore') selectTab($<HTMLButtonElement>('tab-' + tab));
  if (tab === 'settings' && !$('wallet').hidden) openSettings();
  if (params.get('security') === 'passkey') {
    $<HTMLDetailsElement>('passkey-panel').open = true;
  }
});
setInterval(() => {
  guardApproval();
  tickSessionReview();
  if (minting && minting.state !== 'ended') paintSession();
  if (pending && Date.now() >= pending.expires)
    message('This request expired. Start a new request from the site.', true);
}, 1000);

// UI polling contains no secrets and does not extend the session's absolute deadline.
setInterval(() => {
  if (busy || !state?.account) return;
  const request = renderRequest;
  void call<UIState>('status')
    .then(async (next) => {
      if (busy || request !== renderRequest) return;
      // Another view (popup or side panel) switched the network: follow it.
      if (next.network?.switchable && state?.network && next.network.active !== state.network.active)
        return void task(() => followNetwork(next.network!.active));
      const switched = next.account?.owner !== state?.account?.owner;
      const renamed =
        next.name !== state?.name ||
        JSON.stringify(next.accounts) !== JSON.stringify(state?.accounts);
      if (switched) {
        passkeyAbort?.abort();
        resetAccountView();
        // The progress stays in place: the session poll reports the account change.
        if (minting) state = next;
        else await render();
        if (!requestId) await balances();
        if ($<HTMLDialogElement>('accounts-dialog').open) showAccounts();
        return;
      }
      const changed =
        next.unlocked !== state?.unlocked ||
        JSON.stringify(next.unlockSetup) !== JSON.stringify(state?.unlockSetup);
      state = next;
      if (renamed) {
        syncControls();
        if ($<HTMLDialogElement>('accounts-dialog').open && !$('accounts-overview').hidden)
          populateAccounts();
      }
      if (changed && !next.unlocked) {
        passkeyAbort?.abort();
        $('phrase').textContent = '';
        $('recovery').hidden = true;
        clearSecrets();
      }
      if (changed) {
        watchOnly = false;
        if (requestId && next.unlocked && !minting) await render();
        else syncViews();
      }
      syncPreferences();
      guardApproval();
    })
    .catch(() => {
      pending = undefined;
      if (minting) minting = endedLocally(minting, 'restarted', Date.now());
      paintSession();
      if (state) state = { ...state, unlocked: false, unlockSetup: null };
      passkeyAbort?.abort();
      resetAccountView();
      syncViews();
      guardApproval();
      message('Wallet background restarted. Reopen the wallet and check saved history.', true);
      $('phrase').textContent = '';
      $('recovery').hidden = true;
      clearSecrets();
    });
}, 5000);
