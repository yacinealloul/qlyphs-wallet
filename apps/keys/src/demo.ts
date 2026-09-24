import { createWalletConnector } from '../../../packages/sdk/src/index.ts';
import type { ProviderState } from '../../../packages/provider/src/index.ts';
import { createKeysProvider } from './sdk.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const provider = createKeysProvider();
const connector = createWalletConnector({ provider });
const code = (e: unknown) => (e as { code?: string })?.code ?? 'UNAVAILABLE';
const log = (line: string) => {
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString()} ${line}`;
  $('log').prepend(li);
};
const render = (state: ProviderState) => {
  $('status').textContent = state.connected ? 'Connected' : 'Not connected';
  $('account').textContent = state.accounts[0]?.address ?? '—';
  $('network').textContent =
    (state.network as { genesis?: string } | null)?.genesis ?? state.accounts[0]?.genesis ?? '—';
  $<HTMLButtonElement>('disconnect').disabled = !state.connected;
};

provider.on!('stateChanged', render);
provider.on!('disconnect', (e) => log(`disconnect ${e.code}`));
provider
  .request({ method: 'state' })
  .then((s) => render(s as ProviderState))
  .catch((e) => log(code(e)));

// No await before request: the popup must open inside the click.
$('connect').addEventListener('click', () => {
  provider.request({ method: 'connect' }).then(
    (a) => log(`connect ${(a as unknown[]).length} account(s)`),
    (e) => log(`connect ${code(e)}`),
  );
});
$('connector').addEventListener('click', () => {
  connector.connect().then(
    (a) => log(`connector ${a.length} account(s)`),
    (e) => log(`connector ${code(e)}`),
  );
});
$('disconnect').addEventListener('click', () => {
  provider.request({ method: 'disconnect' }).then(
    () => log('disconnected'),
    (e) => log(`disconnect ${code(e)}`),
  );
});
