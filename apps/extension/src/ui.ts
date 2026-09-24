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
import { VERSION, EXPLORER, loadNetwork } from './config.ts';
import { MAINNET_BUILD } from './profile.ts';
import { applyNetworkCopy, networkName } from './network-copy.ts';
import { formatUnits, parseUnits, json } from '../../native/src/commands.ts';
import { fromHex, hex } from '../../../packages/native/src/codec.ts';
import { decodeAccountId, encodeAccountId } from '../../../packages/chain/src/codec/address.ts';
import { arrive, drop, flash, nudge, pop, roll } from './feel.ts';
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
import type { Asset, Review, Manifest, Status } from './network.ts';
import { renderQlyph, qlyphSize } from './qlyph-render.ts';
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
$('build-version').textContent = 'v' + VERSION;
$('about-version').textContent = (MAINNET_BUILD ? 'Mainnet · v' : 'Development · v') + VERSION;
applyNetworkCopy();
$('menu-version').textContent = 'v' + VERSION;
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
  network?: { active: 'development' | 'mainnet'; switchable: boolean; carry?: boolean };
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
  createdAt?: number;
  height?: number;
  amount?: string;
  to?: string;
  symbol?: string;
  decimals?: number;
}
interface Confirmation {
  kind: string;
  origin: string;
  account: { owner: string; address: string; genesis: string };
  expires: number;
  review: Review | null;
  digest: string;
  unlocked: boolean;
}
let state: UIState | undefined,
  pending: Confirmation | undefined,
  candidate: Status | undefined,
  assets: Asset[] = [],
  busy = false;
let addingWallet = false;
let resetOwner: string | undefined;
let resetBackupSaved = false;
let renamedOwner: string | undefined;
let balanceRequest = 0;
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
  mint: 'Mint tokens',
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
  const r = (await browser.runtime.sendMessage({
    action,
    ...params,
    ...(ACCOUNT_SCOPED_ACTIONS.has(action) ? { expectedOwner: state?.account?.owner } : {}),
  })) as {
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
    !!state?.account && !!state.unlocked && !!$('recovery').hidden && !addingWallet;
  selector.hidden = !accountControls;
  selector.disabled = busy || !!requestId || !accountControls;
  document.body.dataset.accountControls = String(accountControls);
  if (!accountControls) {
    $<HTMLDialogElement>('accounts-dialog').close();
    $<HTMLDialogElement>('wallet-menu').close();
    $('accounts-list').replaceChildren();
    $<HTMLInputElement>('account-name').value = '';
    renamedOwner = undefined;
  }
  $('create-password-title').textContent = addingWallet
    ? 'Protect your backup'
    : 'Set your password';
  $('create-password-intro').textContent = addingWallet
    ? 'Choose a password for this wallet’s backup file. Your Qlyphs unlock stays the same.'
    : 'One password unlocks all your wallets on this device.';
  $('import-password-title').textContent = addingWallet
    ? 'Protect your backup'
    : 'Secure this device';
  $('import-password-intro').textContent = addingWallet
    ? 'Choose a password for this wallet’s backup file. Your Qlyphs unlock stays the same.'
    : 'Choose one password to unlock all your wallets on this device.';
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
  if (state?.account) paintAccountAvatar($('menu-account-avatar'), state.account.owner);
  $('menu-account-name').textContent = state?.name ?? 'Account 1';
  $('menu-account-address').textContent = state?.account ? short(state.account.address) : '';
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
  $('new-wallet').hidden = !state?.manifest || (!!state.account && !addingWallet) || !!requestId;
  $('unlock').hidden =
    !state?.account || !!state?.unlocked || watchOnly || recovery || addingWallet;
  $('wallet').hidden =
    !state?.account || !!requestId || (!state.unlocked && !watchOnly) || recovery || addingWallet;
  $('confirmation').hidden =
    !requestId || !pending || !state?.unlocked || !pending.unlocked || recovery || !!sent;
  $('tx-result').hidden = !requestId || !sent;
  if (sent) $('unlock').hidden = true;
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
function pairs(id: string, items: [string, string][]) {
  if (id !== 'review-summary') {
    $(id).replaceChildren(...items.flatMap(([k, v]) => [node('dt', k), node('dd', v)]));
    return;
  }
  // Keep exact identifiers and charges available without making every review a stack of cards.
  const groups = new Map<string, [string, string][]>();
  for (const item of items) {
    const title = /^(Network|Signing account|Genesis)$/.test(item[0])
      ? 'Account & network'
      : /^(Network fee|Native |Qlyphs fee$|Estimated total)/.test(item[0])
        ? 'Estimated fees'
        : 'Transaction details';
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title)!.push(item);
  }
  const rows = (values: [string, string][], recipientOnly = false) => {
    const list = node('dl', '', 'rows');
    for (const [k, v] of values) {
      const row = node(
        'div',
        '',
        'review-row' +
          (/recipient|account|genesis|asset ID|buyer|payout/i.test(k) ? ' identifier' : '') +
          (k === 'Estimated total' ? ' review-total' : ''),
      );
      row.append(node('dt', k, recipientOnly ? 'sr-only' : ''), node('dd', v));
      list.append(row);
    }
    return list;
  };
  $('review-summary').replaceChildren(
    ...[...groups].map(([title, values]) => {
      if (title === 'Account & network' && pending?.kind !== 'connect') {
        const group = node('details', '', 'review-disclosure review-account');
        const summary = node('summary', '');
        const account = node('span', state?.name ?? 'Your account', 'review-account-name');
        if (pending) account.append(node('small', short(pending.account.address)));
        summary.append(node('span', 'Sending from'), account);
        group.append(summary, rows(values));
        return group;
      }
      const group = node('section', '', 'review-group');
      const recipientOnly = values.length === 1 && values[0]![0] === 'Recipient';
      const heading = node('h2', recipientOnly ? 'To' : title);
      group.append(heading);
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
      group.append(
        rows(
          values.filter((value) => !zeroFees.includes(value)),
          recipientOnly,
        ),
      );
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
    (b) => !b.disabled && !b.matches('[role=tab], [data-password], #hide-balance'),
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
      $<HTMLButtonElement>('add-wallet').disabled =
        !state?.unlocked || !state.backed || count >= 20;
      $<HTMLButtonElement>('add-account').disabled =
        !state?.unlocked || !state.backed || count >= 20;
    }
  }
}
function guardApproval() {
  $<HTMLButtonElement>('approve').disabled =
    busy ||
    !pending ||
    !state?.unlocked ||
    !pending.unlocked ||
    Date.now() >= pending.expires ||
    (pending.kind === 'transaction' && (!state?.unlocked || !state.backed));
  $<HTMLButtonElement>('reject').disabled = busy || !pending;
}
type OnboardingScreen =
  | 'choice'
  | 'create'
  | 'import-choice'
  | 'phrase'
  | 'import-password'
  | 'backup'
  | 'restore-password'
  | 'carry';
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
  $('onboarding-back').hidden = screen === 'choice' && !addingWallet;
  $('onboarding-back').setAttribute(
    'aria-label',
    screen === 'choice' && addingWallet ? 'Back to accounts' : 'Back',
  );
  $('onboarding-progress').textContent = {
    choice: addingWallet ? 'Add a wallet' : 'Set up your wallet',
    create: 'Create wallet',
    'import-choice': 'Import wallet',
    phrase: 'Recovery phrase · 1 of 2',
    'import-password': 'Recovery phrase · 2 of 2',
    backup: 'Encrypted backup · 1 of 2',
    'restore-password': 'Encrypted backup · 2 of 2',
    carry: 'Development wallet',
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
    'carry-password',
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
  $('new-wallet').hidden = !state.manifest || (!!state.account && !addingWallet) || !!requestId;
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
    $('address').textContent = short(state.account.address);
    $('copy-address').title = 'Copy ' + state.account.address;
    $('receive-address').textContent = state.account.address;
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
  if (requestId && !sent) {
    pending = await call<Confirmation>('review', { id: requestId });
    state.unlocked = pending.unlocked;
    $('review-title').textContent =
      pending.kind === 'connect'
        ? 'Connect to this site?'
        : (labels[String(pending.review!.command.kind)] ?? 'Review transaction');
    $('review-origin').textContent = pending.origin;
    $('approve').textContent = pending.kind === 'connect' ? 'Connect' : 'Approve transaction';
    const rows: [string, string][] = [];
    $('review-amount').hidden = true;
    $('review-qlyph').hidden = true;
    $('review-qlyph').replaceChildren();
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
      // QLYP-v1 Qlyphs fee: 1 QTC per token created, 0.01 QTC per mint, 0.1 QTC per Quark
      // created, 1% of a purchase price.
      const qlyphsFee = formatUnits(BigInt(f.platformFee), 12) + ' QTC';
      rows.push(
        ['Qlyphs fee', c.kind === 'buy' ? '1% · ' + qlyphsFee : qlyphsFee],
        ['Network fee estimate', formatUnits(BigInt(f.networkFee), 12) + ' QTC'],
        ['Native non-refundable charge', formatUnits(BigInt(f.nativeFee), 12) + ' QTC'],
        ['Native refundable deposit', formatUnits(BigInt(f.deposit), 12) + ' QTC'],
      );
      const spent =
        c.kind === 'sendQtc'
          ? BigInt(String(c.amount))
          : c.kind === 'buy' && offer
            ? BigInt(String(offer.price))
            : c.kind === 'deploy' || c.kind === 'mint' || c.kind === 'inscribe'
              ? 0n
              : undefined;
      if (spent !== undefined) {
        const total =
          spent +
          BigInt(f.networkFee) +
          BigInt(f.nativeFee) +
          BigInt(f.deposit) +
          BigInt(f.platformFee);
        rows.push(['Estimated total', formatUnits(total, 12) + ' QTC']);
      }
      $('review-warning').textContent =
        c.kind === 'inscribe'
          ? 'A Quark is the equivalent of an NFT: unique, numbered content with a single owner. Its content is public and permanent. Every Quantus transaction is signed with ML-DSA (post-quantum), so this Quark\'s provenance is bound to a post-quantum signature on chain. Its number is assigned at inclusion. Fees are estimates.'
          : c.kind === 'buy'
          ? 'Before signing, this extension requires matching, fresh ML-DSA attestations from both configured witnesses. These are operator claims, not consensus proofs. Network fees are estimates.'
          : 'Fees are estimates, not a guaranteed cap. Approval signs only this operation.';
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
    $('expires').textContent =
      'Review expires at ' + new Date(pending.expires).toLocaleTimeString();
    guardApproval();
  }
  message('');
  syncViews();
}
const expandedActivity = new Set<string>();
const seenActivity = new Map<string, string>();
function renderHistory(txs: Tx[]) {
  // Status can briefly return an empty list before the balance response arrives.
  // Retain disclosure state across both renders, without a delayed toggle handler.
  for (const detail of $('history').querySelectorAll<HTMLDetailsElement>('details')) {
    if (detail.open) expandedActivity.add(detail.dataset.hash!);
    else expandedActivity.delete(detail.dataset.hash!);
  }
  while (expandedActivity.size > 200)
    expandedActivity.delete(expandedActivity.values().next().value!);
  $('history').replaceChildren(
    ...(txs.length
      ? txs.map((tx) => {
          const failed =
            tx.nativeSuccess === false ||
            !!tx.verdict?.startsWith('rejected') ||
            ['expired', 'cancelled-before-broadcast'].includes(tx.status);
          const final = tx.status === 'finalized' && tx.nativeSuccess === true && !failed;
          const status = failed
            ? 'Failed'
            : final
              ? 'Finalized'
              : tx.status === 'broadcast-uncertain'
                ? 'Check status'
                : tx.status.replaceAll('-', ' ');
          const e = document.createElement('details');
          e.className = 'activity-item';
          const seen = seenActivity.get(tx.hash);
          if (seenActivity.size && seen === undefined) requestAnimationFrame(() => arrive(e, true));
          e.dataset.hash = tx.hash;
          e.open = expandedActivity.has(tx.hash);
          const heading = node('summary', '', 'activity-heading');
          const info = node('span', '', 'activity-info');
          const amount = transferLine(tx);
          info.append(
            node('strong', labels[tx.label] ?? tx.label),
            amount
              ? node('span', `−${amount} · to ${recipientLine(tx.to)}`, 'activity-hash')
              : node('span', short(tx.hash), 'activity-hash mono'),
          );
          if (seen !== undefined && seen !== status)
            requestAnimationFrame(() => pop(heading.querySelector('.status-chip')));
          seenActivity.set(tx.hash, status);
          heading.append(
            icon(failed ? 'close' : final ? 'check' : 'clock'),
            info,
            node(
              'span',
              status.charAt(0).toUpperCase() + status.slice(1),
              'status-chip' + (failed ? ' error' : final ? ' success' : ''),
            ),
          );
          const detail = node('div', '', 'activity-detail');
          const identity = node('div', '', 'activity-identity');
          const id = node('div', '', 'activity-id');
          id.append(
            node('span', 'Transaction ID', 'activity-detail-label'),
            node('p', tx.hash, 'mono'),
          );
          const copy = node('button', '', 'icon');
          copy.setAttribute('type', 'button');
          copy.setAttribute('aria-label', 'Copy transaction ID ' + tx.hash);
          copy.title = 'Copy transaction ID';
          copy.append(icon('copy'));
          copy.addEventListener('click', () => void task(() => copyText(copy, tx.hash), copy));
          identity.append(id, copy);
          detail.append(identity);
          if (tx.verdict) detail.append(node('p', tx.verdict, 'activity-verdict'));
          if (/^0x[0-9a-f]{64}$/i.test(tx.hash)) {
            const explore = node('button', 'View in explorer ', 'secondary activity-explorer');
            explore.setAttribute('type', 'button');
            explore.setAttribute(
              'aria-label',
              'View transaction ' + tx.hash + ' in explorer (opens in a new tab)',
            );
            explore.append(icon('expand'));
            explore.addEventListener(
              'click',
              () => void task(() => openExplorer(tx.hash), explore),
            );
            detail.append(explore);
          }
          e.append(heading, detail);
          return e;
        })
      : [empty('No activity yet', 'Your transfers and trades will show up here.', 'clock')]),
  );
}
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
function paintSteps(element: HTMLElement, stage: TxStage) {
  element.dataset.stage = stage;
  element.dataset.step = String(stageStep(stage));
}
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
  const tracker = $('tx-tracker');
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
    stage === 'finalized' || stage === 'included'
      ? 'Sent'
      : stage === 'failed'
        ? 'Not sent:'
        : stage === 'approval'
          ? 'Confirm'
          : 'Sending';
  $('tx-tracker-title').textContent =
    amount && stage !== 'failed' ? `${verb} ${amount}` : tx ? (labels[tx.label] ?? text.title) : text.title;
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
  if (busy || document.hidden) return;
  if (requestId) {
    if (sent?.hash && !stageDone(sent.stage))
      void call<BalanceView>('balances')
        .then((v) => {
          recordChain(v.chain);
          followResult(v.transactions);
        })
        .catch(() => undefined);
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
  // Follow in-flight transfers and locked incoming funds until they settle.
  if ((!$('tx-tracker').hidden || $('incoming').dataset.visible) && state?.account)
    void balances(true).catch(() => undefined);
}, 4000);
const assetAmounts = new Map<string, string>();
function assetRow(
  symbol: string,
  title: string,
  amount: string,
  id?: string,
  exactAmount = amount,
) {
  const e = node('button', '', 'asset-row') as HTMLButtonElement;
  e.type = 'button';
  const badge = node(
    'span',
    id ? symbol.slice(0, 2).toUpperCase() : '',
    'asset-icon' + (id ? '' : ' native'),
  );
  if (!id) badge.textContent = 'Q';
  const info = node('span', '', 'asset-info');
  info.append(node('strong', id ? symbol : 'Quantus'), node('small', title));
  const quantity = node('span', privateBalances ? '••••' : amount, 'asset-amount');
  const key = id ?? 'qtc',
    previous = assetAmounts.get(key);
  assetAmounts.set(key, exactAmount);
  if (previous !== undefined && previous !== exactAmount && !privateBalances)
    requestAnimationFrame(() =>
      flash(quantity, Number(exactAmount) > Number(previous) ? 'up' : 'down'),
    );
  if (!privateBalances) quantity.title = exactAmount + ' ' + symbol;
  e.append(badge, info, quantity);
  e.setAttribute('aria-label', 'Send ' + symbol + (id ? ' · ' + id : ''));
  e.addEventListener('click', () => openSend(id ?? 'qtc', e));
  return e;
}
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
function paintIncoming(incoming: bigint) {
  const element = $('incoming');
  if (!incoming || privateBalances) {
    delete element.dataset.visible;
    return;
  }
  const chain = chainSamples[chainSamples.length - 1];
  const rate = blockRate(chainSamples);
  const wait =
    chain && rate
      ? ` · spendable in ~${Math.max(1, Math.ceil((chain.head - chain.finalized) / rate / 60_000))} min`
      : ' · locked until final';
  $('incoming-text').textContent = `+${formatBalance(incoming, 12)} QTC arriving${wait}`;
  element.title =
    'Received in a block that is not final yet. It is locked and joins your balance once the network finalizes it.';
  element.dataset.visible = 'true';
}
function paintBalances() {
  const v = balanceView;
  if (!v) return;
  // Headline = settled funds. Anything received in a block that is not final yet is
  // shown apart, locked, and joins the balance (with its +received cue) once final.
  const incoming = incomingBalance(v.balance);
  const free = BigInt(v.balance.free) - incoming;
  const amount = formatBalance(free, 12);
  const exactAmount = formatUnits(free, 12);
  paintIncoming(incoming);
  const before = lastBalance && lastBalance.owner === v.owner ? lastBalance.free : undefined;
  lastBalance = { owner: v.owner, free };
  $('balance').replaceChildren(
    document.createTextNode(privateBalances ? '••••' : amount),
    node('small', ' QTC'),
  );
  if (before !== undefined && before !== free && !privateBalances) {
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
  $('balance').setAttribute('aria-label', privateBalances ? 'Balance hidden' : amount + ' QTC');
  $('balance').title = privateBalances ? '' : exactAmount + ' QTC';
  $('reserved').textContent = privateBalances
    ? ''
    : BigInt(v.balance.reserved) || BigInt(v.balance.frozen)
      ? `Reserved ${formatBalance(BigInt(v.balance.reserved), 12)} · Frozen ${formatBalance(BigInt(v.balance.frozen), 12)} QTC`
      : '';
  if ($('reserved').textContent) $('reserved').dataset.visible = 'true';
  else delete $('reserved').dataset.visible;
  const held = assets.filter((a) => BigInt(a.available) > 0n);
  $('tokens').replaceChildren(
    assetRow('QTC', 'QTC', amount, undefined, exactAmount),
    ...held.map((a) =>
      isQlyph(a)
        ? assetRow(assetName(a), '1 of 1 · ' + short(a.id), '1', a.id)
        : assetRow(
            a.definition.symbol,
            short(a.id),
            formatBalance(BigInt(a.available), a.definition.decimals),
            a.id,
            formatUnits(BigInt(a.available), a.definition.decimals),
          ),
    ),
  );
  $('asset-count').textContent = String(held.length + 1);
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
      o.textContent = assetName(a) + ' · ' + short(a.id);
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
}
function sendAssetDetails() {
  const id = value('send-asset');
  const asset = assets.find((a) => a.id === id && BigInt(a.available) > 0n);
  const native = id === 'qtc';
  const symbol = native ? 'QTC' : asset ? assetName(asset) : undefined;
  // A Quark moves as a whole: the amount is fixed to 1.
  const whole = isQlyph(asset),
    amount = $<HTMLInputElement>('send-amount');
  amount.readOnly = whole;
  if (whole) amount.value = '1';
  $('send-title').textContent = symbol ? 'Send ' + symbol : 'Send asset';
  $('send-unit').textContent = symbol ?? '—';
  $('send-unit').title = symbol ?? '';
  $('send-asset').title = native ? 'QTC · Quantus native token' : id;
  const available = native ? freeBalance : asset ? BigInt(asset.available) : undefined;
  $('send-available').textContent = whole
    ? 'Quark · 1 of 1. The whole Quark moves to the recipient. Fees in QTC.'
    : available === undefined
      ? 'Balance unavailable. Refresh before sending.'
      : privateBalances
        ? 'Balance hidden · Fees are paid in QTC.'
        : `Available: ${formatUnits(available, native ? 12 : asset!.definition.decimals)} ${symbol} · Fees in QTC.` +
          (native && balanceView && incomingBalance(balanceView.balance)
            ? ` ${formatBalance(incomingBalance(balanceView.balance), 12)} QTC locked until final.`
            : '');
}
function changeSendAsset() {
  $<HTMLInputElement>('send-amount').value = '';
  transferFeedback('send-amount');
  sendAssetDetails();
}
let sendTrigger: HTMLElement | undefined;
function openSend(id = 'qtc', trigger: HTMLElement = $('show-send')) {
  const select = $<HTMLSelectElement>('send-asset');
  if (select.value !== id) {
    select.value = id;
    changeSendAsset();
  } else sendAssetDetails();
  sendTrigger = trigger;
  openPanel('send-panel');
}
async function balances(quiet = false) {
  if (!state?.account) return;
  if (backgroundNeedsUpdate())
    throw Error('Wallet update pending. Reload the extension to finish updating.');
  if (!quiet) document.body.dataset.refreshing = 'true';
  const owner = state.account.owner,
    request = ++balanceRequest;
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
  } catch (e) {
    if (request !== balanceRequest || state?.account?.owner !== owner) return;
    $('sync-state').textContent = balanceView
      ? 'Refresh failed · Showing previously loaded balances.'
      : 'Balances unavailable · Try refreshing.';
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
    if (request === balanceRequest) document.body.dataset.refreshing = 'false';
  }
}
function resetAccountView() {
  seenActivity.clear();
  assetAmounts.clear();
  lastBalance = undefined;
  delete $('balance-delta').dataset.visible;
  delete $('incoming').dataset.visible;
  $<HTMLDialogElement>('reset-dialog').close();
  balanceRequest++;
  balanceView = undefined;
  freeBalance = undefined;
  assets = [];
  watchOnly = false;
  expandedActivity.clear();
  $('balance').textContent = '—';
  $('balance').removeAttribute('title');
  $('balance').removeAttribute('aria-label');
  $('wallet').scrollTop = 0;
  syncWalletScroll();
  $('tokens').replaceChildren();
  $('history').replaceChildren();
  $('send-asset').replaceChildren(new Option('QTC · Native token', 'qtc'));
  sendAssetDetails();
  $('sync-state').textContent = '';
  $('receive-address').textContent = '';
  const canvas = $<HTMLCanvasElement>('receive-qr');
  canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  for (const form of document.querySelectorAll<HTMLFormElement>('#wallet form')) form.reset();
  clearTransferFeedback();
  for (const panel of document.querySelectorAll<HTMLDetailsElement>('#wallet details[open]'))
    panel.open = false;
  clearSecrets();
  $('phrase').textContent = '';
  $('recovery').hidden = true;
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
                addingWallet = false;
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
          `Wallet ${walletOwners.indexOf(walletOwner) + 1}`,
          'account-wallet-heading',
        );
        heading.dataset.wallet = walletOwner;
        return [heading, row];
      }
      return [row];
    }),
  );
  filterAccounts();
  const add = $<HTMLButtonElement>('add-wallet');
  add.disabled = busy || !state?.unlocked || !state.backed || all.length >= 20;
  $<HTMLButtonElement>('add-account').disabled = add.disabled;
  $('add-wallet-hint').textContent =
    all.length >= 20
      ? 'You have reached the limit of 20 accounts.'
      : !state?.unlocked
        ? 'Unlock Qlyphs to add another wallet.'
        : !state.backed
          ? 'Save your recovery phrase before adding another wallet.'
          : '';
  $('add-wallet-hint').hidden = !$('add-wallet-hint').textContent;
}
function filterAccounts() {
  const query = value('account-search').trim().toLocaleLowerCase();
  let count = 0;
  for (const row of $('accounts-list').querySelectorAll<HTMLElement>('.account-option')) {
    row.hidden = !row.dataset.search?.includes(query);
    if (!row.hidden) count++;
    for (const menu of row.querySelectorAll<HTMLElement>(':popover-open')) menu.hidePopover();
  }
  $('accounts-count').textContent = String(count);
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
  if (!state?.unlocked || requestId || !$('recovery').hidden || addingWallet) return;
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
$('open-accounts').addEventListener('click', () => {
  if (!busy && !requestId) showAccounts();
});
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
$('add-wallet').addEventListener('click', () => {
  if (busy || !state?.unlocked || !state.backed) return;
  $<HTMLDialogElement>('accounts-dialog').close();
  clearSecrets();
  $<HTMLInputElement>('backup-file').value = '';
  addingWallet = true;
  message('');
  syncViews();
  onboarding('choice');
});
click('carry-accounts', async () => {
  if (!state?.unlocked) return;
  clearSecrets();
  addingWallet = true;
  message('');
  syncViews();
  onboarding('carry');
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
  ['choose-carry', 'carry'],
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
  if (addingWallet && onboardingScreen === 'choice') {
    addingWallet = false;
    clearSecrets();
    $<HTMLInputElement>('backup-file').value = '';
    syncViews();
    showAccounts();
    return;
  }
  const previous: Record<OnboardingScreen, OnboardingScreen> = {
    choice: 'choice',
    create: 'choice',
    'import-choice': 'choice',
    phrase: 'import-choice',
    'import-password': 'phrase',
    backup: 'import-choice',
    'restore-password': 'backup',
    carry: 'choice',
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
    const v = await call<{ phrase: string }>(addingWallet ? 'account-create' : 'create', {
      password: value('new-password'),
    });
    addingWallet = false;
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
    await call(addingWallet ? 'account-import' : 'import', {
      password: value('import-password'),
      phrase: value('import-phrase'),
    });
    addingWallet = false;
    clearSecrets();
    await render();
    message('Wallet imported.', false, true);
    await balances();
  } catch (error) {
    $<HTMLInputElement>('import-password').value = '';
    throw error;
  }
});
form('carry-form', async () => {
  if (onboardingScreen !== 'carry') return;
  message('');
  try {
    const r = await call<{ carried: number; skipped: number }>('carry', {
      password: value('carry-password'),
    });
    addingWallet = false;
    clearSecrets();
    await render();
    message(
      `${r.carried === 1 ? '1 account' : `${r.carried} accounts`} ready on mainnet.` +
        (r.skipped ? ` ${r.skipped} use another password: import them separately.` : ''),
      false,
      true,
    );
    await balances();
  } catch (error) {
    $<HTMLInputElement>('carry-password').value = '';
    throw error;
  }
});
form('restore-form', async () => {
  if (onboardingScreen !== 'restore-password') return;
  message('');
  try {
    await call(addingWallet ? 'account-restore' : 'restore', {
      password: value('restore-password'),
      backup: await readBackup(),
    });
    addingWallet = false;
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
          : 'This is a different development chain. Restart the original local chain to use this wallet’s balances.'
        : 'The chain matches, but its runtime, activation or network format differs. Restore the saved configuration before sending.';
    $('message').textContent = matches
      ? 'The saved network is available again.'
      : differentChain
        ? MAINNET_BUILD ? 'A different network is connected. Sending is paused.' : 'A different development network is running. Sending is paused.'
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
/** Swap and Qlyphs are announced, not live: a tap answers with a short note instead of nothing. */
const SOON = {
  swap: ['Swap is coming', 'Trade QTC in one tap, without leaving your wallet.'],
  qlyphs: ['Qlyphs is coming', 'Your Qlyphs apps, one tap from your wallet.'],
} as const;
let soonTimer = 0;
function hideSoon() {
  clearTimeout(soonTimer);
  const bubble = $('soon-bubble');
  if (bubble.hidden) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    bubble.hidden = true;
    return;
  }
  bubble
    .animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-4px)' }], {
      duration: 140,
      easing: 'ease-in',
    })
    .finished.then(() => (bubble.hidden = true), () => (bubble.hidden = true));
}
function showSoon(button: HTMLElement) {
  const kind = button.dataset.soon as keyof typeof SOON;
  pop(button.querySelector('.soon-pill') ?? button);
  // Only the quick-action row carries the bubble; the Qlyphs card already says it in place.
  if (!button.classList.contains('round')) return;
  const bubble = $('soon-bubble'),
    reopen = !bubble.hidden && bubble.dataset.for === kind;
  $('soon-title').textContent = SOON[kind][0];
  $('soon-text').textContent = SOON[kind][1];
  bubble.dataset.for = kind;
  bubble.style.setProperty('--tip', `${button.offsetLeft + button.offsetWidth / 2}px`);
  bubble.hidden = false;
  if (!reopen) drop(bubble);
  clearTimeout(soonTimer);
  soonTimer = window.setTimeout(hideSoon, 2600);
}
for (const button of document.querySelectorAll<HTMLElement>('[data-soon]'))
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    showSoon(button);
  });
document.addEventListener('click', hideSoon);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideSoon();
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
    addingWallet = false;
    watchOnly = false;
    clearSecrets();
    await render();
    onboarding('create');
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
  $<HTMLDetailsElement>('send-panel').open = false;
  awaitingSince = Date.now();
  awaitingAmount = formatUnits(BigInt(fields.amount), native ? 12 : asset!.definition.decimals) +
    ' ' + (native ? 'QTC' : assetName(asset!));
  trackedHash = undefined;
  trackerUntil = 0;
  paintTracker(balanceView?.transactions ?? state?.transactions ?? []);
});
$('tx-tracker').addEventListener('click', () => {
  const hash = $('tx-tracker').dataset.hash;
  selectTab($<HTMLButtonElement>('tab-activity'), true);
  if (!hash) return;
  expandedActivity.add(hash);
  const item = $('history').querySelector<HTMLDetailsElement>(`details[data-hash="${hash}"]`);
  if (item) {
    item.open = true;
    item.scrollIntoView({ block: 'nearest' });
  }
});
click('reject', async () => {
  await call('reject', { id: requestId });
  window.close();
});
click('cancel-unlock', async () => {
  await call('reject', { id: requestId });
  window.close();
});
click('approve', async () => {
  const review = pending;
  if (!review || Date.now() >= review.expires) throw Error('No valid review to approve');
  // A consumed/failed review cannot be clicked a second time from a stale popup.
  pending = undefined;
  if (review.kind !== 'transaction') {
    await call('approve', { id: requestId, digest: review.digest });
    window.close();
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
});
click('tx-result-done', async () => window.close());
click('tx-result-explorer', async () => {
  if (sent?.hash) await openExplorer(sent.hash);
});
click('tx-result-hash', async () => {
  if (sent?.hash) await copyText($('tx-result-hash'), sent.hash);
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
const panels = ['send-panel', 'receive-panel'];
const triggers: Record<string, string> = {
  'send-panel': 'show-send',
  'receive-panel': 'show-receive',
};
function openPanel(id: string) {
  $('wallet').scrollTop = 0;
  for (const p of panels) $<HTMLDetailsElement>(p).open = p === id;
  $(id).scrollTop = 0;
  $(id)
    .querySelectorAll('.flow-content')
    .forEach((content) => content.scrollTo(0, 0));
  motion.reveal($(id), pointerInput, true);
  requestAnimationFrame(
    () =>
      $<HTMLDetailsElement>(id).open &&
      $<HTMLDetailsElement>(id)
        .querySelector<HTMLElement>('input,select,button')
        ?.focus({ preventScroll: true }),
  );
}
for (const id of panels)
  $<HTMLDetailsElement>(id).addEventListener('toggle', () => {
    if (!$<HTMLDetailsElement>(id).open && !panels.some((p) => $<HTMLDetailsElement>(p).open)) {
      motion.cancel();
      (id === 'send-panel' && sendTrigger?.isConnected ? sendTrigger : $(triggers[id]!)).focus({
        preventScroll: true,
      });
    }
  });
$('show-send').addEventListener('click', () => openSend());
click('show-receive', async () => {
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
  openPanel('receive-panel');
});
click('copy-receive', async () => {
  await copyText($('copy-receive'), state!.account!.address);
});
click('retry-network', render);
$('saved-phrase').addEventListener('change', syncControls);
$('send-asset').addEventListener('change', changeSendAsset);
$('watch-wallet').addEventListener('click', () => {
  watchOnly = true;
  syncViews();
  $('unlock').scrollTop = 0;
});
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
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')];
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
  selectTab($<HTMLButtonElement>('tab-settings'));
  $<HTMLDetailsElement>('reveal-panel').open = true;
  $('reveal-password').focus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.querySelector('dialog[open]')) return;
    const id = panels.find((p) => $<HTMLDetailsElement>(p).open);
    if (id) {
      $<HTMLDetailsElement>(id).open = false;
      (id === 'send-panel' && sendTrigger?.isConnected ? sendTrigger : $(triggers[id]!)).focus({
        preventScroll: true,
      });
    }
  }
});
function syncPreferences() {
  $('expand-wallet').hidden = !['popup', 'sidebar'].includes(surface) || !$('recovery').hidden;
  $('open-menu').hidden = !state?.account || $('wallet').hidden || !!requestId;
  $<HTMLButtonElement>('open-menu').disabled = busy;
  $('menu-lock').hidden = !state?.unlocked;
  $('menu-open-tab').hidden = surface === 'tab';
  $('display-settings').hidden = !state?.display?.sidebar;
  syncNetworkSwitch();
  for (const mode of ['sidebar', 'popup'])
    $('display-' + mode).setAttribute('aria-pressed', String(state?.display?.mode === mode));
  $('unlock-passkey').hidden = !state?.passkey || !!state?.unlockSetup;
  $('passkey-divider').hidden = !state?.passkey || !!state?.unlockSetup;
  $('passkey-tab-hint').hidden = !state?.passkey || !!state?.unlockSetup || surface !== 'popup';
  $('passkey-status').textContent = state?.passkey
    ? 'Linked · All wallets on this device'
    : 'Add your device or password manager';
  $('passkey-badge').textContent = state?.passkey ? 'ENABLED' : 'OPTIONAL';
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
  $('notification-status').textContent =
    n?.enabled && !n.permitted
      ? 'Permission removed · Enable to reconnect'
      : on
        ? 'On · Transaction updates'
        : 'Off · Your choice';
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
function syncNetworkSwitch() {
  const switchable = !!state?.network?.switchable;
  $('network-settings').hidden = !switchable;
  for (const label of document.querySelectorAll<HTMLElement>('[data-network-name]'))
    label.textContent = state?.network?.active === 'mainnet' ? 'Quantus Mainnet' : 'Quantus Devnet';
  $('choose-carry').hidden = !state?.network?.carry;
  $('carry-accounts').hidden = !state?.network?.carry || !state?.account;
  for (const group of document.querySelectorAll<HTMLElement>('[data-network-switch]'))
    group.hidden = !switchable;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-switch-network]')) {
    button.setAttribute('aria-pressed', String(state?.network?.active === button.dataset.switchNetwork));
    button.disabled = busy;
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-switch-network]'))
  button.addEventListener('click', async () => {
    const name = button.dataset.switchNetwork as 'mainnet' | 'development';
    if (state?.network?.active === name) return;
    message(
      `Switching to ${name === 'mainnet' ? 'Quantus mainnet' : 'the development network'}… The wallet locks and reopens.`,
      false,
      true,
    );
    try {
      // The wallet locks and moves to the other network; this page reopens on it.
      await call('switch-network', { network: name });
      location.reload();
    } catch (error) {
      message(uiError(error), true);
    }
  });
const walletMenu = $<HTMLDialogElement>('wallet-menu');
let menuExit: Animation | undefined;
function closeWalletMenu(animate = false) {
  if (!walletMenu.open) return;
  menuExit?.cancel();
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    walletMenu.close();
    return;
  }
  const current = getComputedStyle(walletMenu);
  const from = { transform: current.transform, opacity: current.opacity };
  walletMenu.dataset.closing = 'true';
  const exit = walletMenu.animate([from, { transform: 'translateX(8px)', opacity: 0 }], {
    duration: 100,
    easing: 'ease-out',
    fill: 'forwards',
  });
  menuExit = exit;
  void exit.finished
    .then(() => {
      if (menuExit === exit) walletMenu.close();
    })
    .catch(() => {});
}
$('open-menu').addEventListener('click', (event) => {
  if (busy || walletMenu.open) return;
  menuExit?.cancel();
  menuExit = undefined;
  delete walletMenu.dataset.closing;
  walletMenu.dataset.pointer = String(event.detail > 0);
  for (const [id, tab] of [
    ['menu-assets', 'tab-tokens'],
    ['menu-activity', 'tab-activity'],
    ['menu-settings', 'tab-settings'],
  ]) {
    if ($(tab!).getAttribute('aria-selected') === 'true')
      $(id!).setAttribute('aria-current', 'page');
    else $(id!).removeAttribute('aria-current');
  }
  $('menu-open-tab').hidden = surface === 'tab';
  $('open-menu').setAttribute('aria-expanded', 'true');
  $<HTMLButtonElement>('menu-accounts').disabled = !state?.unlocked;
  $('menu-accounts').title = state?.unlocked ? '' : 'Unlock to manage accounts';
  walletMenu.showModal();
  walletMenu.querySelector('.wallet-menu-content')!.scrollTop = 0;
  $('close-menu').focus({ preventScroll: true });
});
$('close-menu').addEventListener('click', (event) => closeWalletMenu(event.detail > 0));
function outsideMenu(event: MouseEvent) {
  const box = walletMenu.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}
let menuBackdropDown = false;
walletMenu.addEventListener('pointerdown', (event) => {
  menuBackdropDown = event.target === walletMenu && outsideMenu(event);
});
walletMenu.addEventListener('click', (event) => {
  if (menuBackdropDown && event.target === walletMenu && outsideMenu(event)) closeWalletMenu(true);
  menuBackdropDown = false;
});
walletMenu.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeWalletMenu();
});
walletMenu.addEventListener('close', () => {
  if (walletMenu.open) return;
  menuExit?.cancel();
  menuExit = undefined;
  delete walletMenu.dataset.closing;
  $('open-menu').setAttribute('aria-expanded', 'false');
});
for (const [id, tab] of [
  ['menu-assets', 'tab-tokens'],
  ['menu-activity', 'tab-activity'],
  ['menu-settings', 'tab-settings'],
] as const)
  $(id).addEventListener('click', () => {
    closeWalletMenu();
    selectTab($<HTMLButtonElement>(tab), true);
    $(tab.replace('tab-', '') + '-tab').focus({ preventScroll: true });
  });
$('menu-accounts').addEventListener('click', () => {
  closeWalletMenu();
  showAccounts();
});
$('menu-explorer').addEventListener('click', () => {
  closeWalletMenu();
  void task(() => openExplorer());
});
$('menu-open-tab').addEventListener('click', () => {
  closeWalletMenu();
  void task(() => openWalletTab());
});
$('menu-lock').addEventListener('click', () => {
  closeWalletMenu();
  $('lock').click();
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
  if (tab === 'settings' || tab === 'activity') selectTab($<HTMLButtonElement>('tab-' + tab));
  if (params.get('security') === 'passkey') {
    $<HTMLDetailsElement>('passkey-panel').open = true;
  }
});
setInterval(() => {
  guardApproval();
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
      const switched = next.account?.owner !== state?.account?.owner;
      const renamed =
        next.name !== state?.name ||
        JSON.stringify(next.accounts) !== JSON.stringify(state?.accounts);
      if (switched) {
        passkeyAbort?.abort();
        addingWallet = false;
        resetAccountView();
        await render();
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
        addingWallet = false;
        passkeyAbort?.abort();
        $('phrase').textContent = '';
        $('recovery').hidden = true;
        clearSecrets();
      }
      if (changed) {
        watchOnly = false;
        if (requestId && next.unlocked) await render();
        else syncViews();
      }
      syncPreferences();
      guardApproval();
    })
    .catch(() => {
      pending = undefined;
      if (state) state = { ...state, unlocked: false, unlockSetup: null };
      addingWallet = false;
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
