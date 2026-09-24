import { browser } from './browser.ts';
import { API, RPC, loadNetwork } from './config.ts';
import { api, network, rpc, type Manifest } from './network.ts';
import { uiError } from './errors.ts';
import { MAINNET_BUILD } from './profile.ts';
import { applyNetworkCopy, networkName } from './network-copy.ts';
import { formatUnits } from '../../native/src/commands.ts';
await loadNetwork();
applyNetworkCopy();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const validHash = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{64}$/i.test(v);
interface SavedTx {
  hash: string;
  label: string;
  status: string;
  createdAt?: number;
  owner?: string;
  genesis?: string;
  nativeSuccess?: boolean | null;
  verdict?: string | null;
}
interface Saved {
  manifest: Manifest | null;
  transactions: SavedTx[];
}
interface Outcome {
  hash: string;
  status: string;
  height?: number;
  nativeSuccess: boolean | null;
  verdict: string | null;
}
interface Receipt {
  hash: string;
  index: number;
  signer: string | null;
  callHex: string;
  success: boolean;
  events: Record<string, unknown>[];
}
interface Block {
  height: number;
  hash: string;
  parent: string;
  receipts: Receipt[];
}
let saved: Saved | undefined,
  selected = '',
  running = 0,
  copiedTimer: ReturnType<typeof setTimeout> | undefined;
const names: Record<string, string> = {
  sendQtc: 'Send QTC',
  transfer: 'Transfer tokens',
  deploy: 'Create token',
  mint: 'Mint tokens',
  sell: 'Reserve tokens',
  buy: 'Buy tokens',
  cancel: 'Cancel reservation',
};
function element(tag: string, text: string, className = '') {
  const e = document.createElement(tag);
  e.textContent = text;
  e.className = className;
  return e;
}
function rows(id: string, values: [string, string][]) {
  $(id).replaceChildren(
    ...values.map(([label, value]) => {
      const row = element('div', '', 'data-row');
      row.append(element('dt', label), element('dd', value));
      return row;
    }),
  );
}
function status(tx: Pick<SavedTx, 'status' | 'nativeSuccess' | 'verdict'>) {
  if (tx.nativeSuccess === false || tx.verdict?.startsWith('rejected')) return 'Failed';
  return (
    (
      {
        finalized: 'Finalized',
        included: 'Included · Awaiting finality',
        pending: 'Pending',
        unknown: 'Check status',
        'broadcast-uncertain': 'Check status',
        expired: 'Expired',
        'cancelled-before-broadcast': 'Not broadcast',
      } as Record<string, string>
    )[tx.status] ?? 'Check status'
  );
}
function message(text: string, error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
}
function historyList() {
  const txs = (saved?.transactions ?? []).filter(
    (tx) => validHash(tx.hash) && (!tx.genesis || tx.genesis === saved?.manifest?.genesis),
  );
  $('history-count').textContent = String(txs.length);
  $('history').replaceChildren(
    ...txs.map((tx) => {
      const row = element('button', '', 'history-row') as HTMLButtonElement;
      row.type = 'button';
      row.setAttribute('aria-current', String(tx.hash.toLowerCase() === selected));
      const info = element('span', '');
      info.append(
        element('strong', names[tx.label] ?? tx.label),
        element('small', tx.hash.slice(0, 10) + '…' + tx.hash.slice(-8)),
      );
      row.append(info, element('em', status(tx) + ' ↗'));
      row.setAttribute('aria-label', `Inspect ${names[tx.label] ?? tx.label} ${tx.hash}`);
      row.addEventListener('click', () => navigate(tx.hash));
      return row;
    }),
  );
  if (!txs.length)
    $('history').append(
      element(
        'p',
        'No saved transactions yet. You can still look up a transaction ID from this network.',
        'muted',
      ),
    );
}
function navigate(hash: string) {
  const url = new URL(location.href);
  url.searchParams.set('tx', hash.toLowerCase());
  history.pushState(null, '', url);
  void load(hash, true);
}
async function load(hash = new URL(location.href).searchParams.get('tx') ?? '', focus = false) {
  const run = ++running;
  selected = '';
  $('transaction').hidden = true;
  $('block-details').hidden = true;
  $('events').replaceChildren();
  $('call-data').textContent = '';
  $('copy').textContent = 'Copy ID';
  clearTimeout(copiedTimer);
  $('refresh').setAttribute('aria-busy', 'true');
  message('Checking your saved network…');
  try {
    if (hash && !validHash(hash))
      throw Error(
        'Invalid transaction ID. Enter a 0x-prefixed hash with 64 hexadecimal characters.',
      );
    const response = (await browser.runtime.sendMessage({ action: 'explorer-status' })) as {
      result?: Saved;
      error?: string;
    };
    if (run !== running) return;
    if (!response.result) throw Error('Reload the wallet extension to open its explorer.');
    saved = response.result;
    historyList();
    if (!saved.manifest) throw Error(MAINNET_BUILD ? 'Set up your wallet first.' : 'Set up your wallet’s development network first.');
    const pinned = saved.manifest;
    const current = await network(pinned);
    if (run !== running) return;
    rows('network-values', [
      ['Network', networkName()],
      ['Saved genesis', pinned.genesis],
      ['Finalized block', String(current.finalized)],
      ['Node', RPC],
      ['Service', API],
    ]);
    if (!hash) {
      message((MAINNET_BUILD ? 'Network' : 'Local network') + ' verified. Select a transaction or paste its ID.');
      return;
    }
    selected = hash.toLowerCase();
    $<HTMLInputElement>('search').value = selected;
    const local = saved.transactions.find((tx) => tx.hash.toLowerCase() === selected);
    const result = await api<Outcome>('/api/transactions/' + selected);
    if (run !== running) return;
    if (result.hash?.toLowerCase() !== selected || typeof result.status !== 'string')
      throw Error('Unexpected transaction response.');
    const noBroadcast = local?.status === 'cancelled-before-broadcast';
    const outcome = noBroadcast ? local : result;
    const data: [string, string][] = [
      ['Transaction ID', selected],
      ['Status', status(outcome)],
      ['Network', networkName()],
    ];
    if (local) {
      data.push(['Operation', names[local.label] ?? local.label]);
      if (local.createdAt && Number.isFinite(local.createdAt))
        data.push(['Submitted', new Date(local.createdAt).toLocaleString()]);
    }
    if (result.verdict) data.push(['Protocol result', result.verdict]);
    const indexed = ['included', 'finalized'].includes(result.status) && !noBroadcast;
    if (indexed) {
      if (!Number.isSafeInteger(result.height) || result.height! < 0)
        throw Error('Invalid transaction block.');
      data.push(
        ['Block', String(result.height)],
        [
          'Execution',
          result.nativeSuccess === true
            ? 'Succeeded'
            : result.nativeSuccess === false
              ? 'Failed'
              : 'Not reported',
        ],
      );
      if (result.status === 'finalized') {
        const block = await api<Block>('/api/blocks/' + result.height);
        const hashAtHeight = await rpc<string>('chain_getBlockHash', [result.height]);
        if (run !== running) return;
        if (
          block.height !== result.height ||
          !validHash(block.hash) ||
          block.hash !== hashAtHeight ||
          block.height > current.finalized ||
          !Array.isArray(block.receipts)
        )
          throw Error('Block could not be verified on the saved network.');
        const receipt = block.receipts.find((r) => r.hash.toLowerCase() === selected);
        if (
          !receipt ||
          !Number.isSafeInteger(receipt.index) ||
          !Array.isArray(receipt.events) ||
          typeof receipt.callHex !== 'string'
        )
          throw Error('Transaction receipt not found in the indexed block.');
        rows('block-values', [
          ['Height', String(block.height)],
          ['Block hash', block.hash],
          ['Transaction index', String(receipt.index)],
          ['Signer', receipt.signer ?? 'Unsigned'],
        ]);
        $('events').replaceChildren(
          ...receipt.events.map((event, i) => {
            const card = element('div', '', 'event');
            card.append(element('h4', `${i + 1}. ${String(event.kind ?? 'Event')}`));
            const list = element('dl', '');
            for (const [key, value] of Object.entries(event))
              if (key !== 'kind') {
                const line = element('div', '', 'data-row');
                const text =
                  event.kind === 'paid' && key === 'amount' && /^\d{1,39}$/.test(String(value))
                    ? `${formatUnits(BigInt(String(value)), 12)} QTC`
                    : typeof value === 'string'
                      ? value
                      : JSON.stringify(value);
                line.append(element('dt', key), element('dd', text));
                list.append(line);
              }
            card.append(list);
            return card;
          }),
        );
        if (!receipt.events.length)
          $('events').append(element('p', 'No decoded events for this transaction.', 'muted'));
        $('call-data').textContent = receipt.callHex;
        $('block-details').hidden = false;
      }
    }
    if ((await rpc<string>('chain_getBlockHash', [0])) !== pinned.genesis)
      throw Error('Block could not be verified on the saved network.');
    if (run !== running) return;
    rows('transaction-values', data);
    $('transaction').hidden = false;
    historyList();
    message(
      noBroadcast
        ? 'This operation was cancelled before broadcast. It has no on-chain record.'
        : !indexed
          ? 'No indexed inclusion found yet. This does not prove success or failure. Refresh to check again.'
          : `Checked against the local network at ${new Date().toLocaleTimeString()}.`,
    );
    if (focus) {
      $('transaction-heading').focus({ preventScroll: true });
      $('transaction').scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  } catch (error) {
    if (run === running) {
      $('transaction').hidden = true;
      message(
        error instanceof Error &&
          /^(Invalid transaction ID|Reload the wallet|Set up your wallet|Unexpected transaction|Invalid transaction block|Block could not|Transaction receipt)/.test(
            error.message,
          )
          ? error.message
          : uiError(error),
        true,
      );
    }
  } finally {
    if (run === running) $('refresh').removeAttribute('aria-busy');
  }
}
$('search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  navigate($<HTMLInputElement>('search').value.trim());
});
$('refresh').addEventListener('click', () => void load());
$('copy').addEventListener('click', () => {
  if (!validHash(selected)) return;
  void navigator.clipboard
    .writeText(selected)
    .then(() => {
      $('copy').textContent = 'Copied';
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => ($('copy').textContent = 'Copy ID'), 1800);
    })
    .catch(() => message('Could not copy. Select the transaction ID to copy it manually.', true));
});
window.addEventListener('popstate', () => void load());
void load();
