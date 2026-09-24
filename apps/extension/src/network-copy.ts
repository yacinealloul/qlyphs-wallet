import { MAINNET_BUILD } from './profile.ts';
/** The HTML carries the development copy; a mainnet build swaps in `data-mainnet` text and labels
 * and drops `data-dev-only` notices once, before the page is shown. */
/** Read when shown: a switchable build knows its network only once `loadNetwork` has run. */
export const networkName = (): string => (MAINNET_BUILD ? 'Quantus mainnet' : 'Quantus development');
export function applyNetworkCopy(root: ParentNode = document): void {
  if (!MAINNET_BUILD) return;
  if (root === document) document.title = document.title.replace(/ · Development$/, '').replace('Local explorer', 'Explorer');
  for (const el of root.querySelectorAll<HTMLElement>('[data-dev-only]')) el.remove();
  for (const el of root.querySelectorAll<HTMLElement>('[data-mainnet]')) el.textContent = el.dataset.mainnet!;
  for (const el of root.querySelectorAll<HTMLElement>('[data-mainnet-label]')) el.setAttribute('aria-label', el.dataset.mainnetLabel!);
}
