import { MAINNET_BUILD } from './profile.ts';
import { TESTNET } from './config.ts';
/** The HTML carries the development copy. A build whose development network is the public testnet
 * swaps in `data-testnet` text; on mainnet, `data-mainnet` text and labels replace it and
 * `data-dev-only` notices hide. A switchable build applies it again in place when the user changes
 * network, so each element keeps its original copy to start from. */
/** Read when shown: a switchable build knows its network only once `loadNetwork` has run. */
export const networkName = (): string =>
  MAINNET_BUILD ? 'Quantus mainnet' : TESTNET ? 'Quantus testnet' : 'Quantus development';
const originals = new WeakMap<HTMLElement, { nodes: Node[]; label: string | null }>();
let originalTitle: string | undefined;
export function applyNetworkCopy(root: ParentNode = document): void {
  if (root === document) {
    originalTitle ??= document.title;
    document.title = MAINNET_BUILD
      ? originalTitle.replace(/ · Development$/, '').replace('Local explorer', 'Explorer')
      : TESTNET
        ? originalTitle.replace(/ · Development$/, ' · Testnet')
        : originalTitle;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-dev-only]')) el.hidden = MAINNET_BUILD;
  for (const el of root.querySelectorAll<HTMLElement>('[data-mainnet], [data-testnet], [data-mainnet-label]')) {
    let original = originals.get(el);
    if (!original)
      originals.set(el, (original = { nodes: [...el.childNodes].map((n) => n.cloneNode(true)), label: el.getAttribute('aria-label') }));
    else el.replaceChildren(...original.nodes.map((n) => n.cloneNode(true)));
    if (original.label === null) el.removeAttribute('aria-label');
    else el.setAttribute('aria-label', original.label);
    // Testnet wording applies on both sides of the switch (the "Testnet" button reads the same on
    // mainnet); mainnet wording then overrides where it exists.
    if (TESTNET && el.dataset.testnet !== undefined) {
      // Only the first non-empty text: an element keeps its icons and styled separators.
      const text = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
      if (text) text.textContent = el.dataset.testnet;
      else el.textContent = el.dataset.testnet;
    }
    if (MAINNET_BUILD && el.dataset.mainnet !== undefined) el.textContent = el.dataset.mainnet;
    if (MAINNET_BUILD && el.dataset.mainnetLabel !== undefined) el.setAttribute('aria-label', el.dataset.mainnetLabel);
  }
}
