import { browser } from './browser.ts';
export type DisplayMode = 'sidebar' | 'popup';
const supported = !!browser.sidePanel && !!browser.action;
let mode: DisplayMode = supported ? 'sidebar' : 'popup';
async function apply(next: DisplayMode) {
  if (!supported) return;
  await browser.action!.setPopup({ popup: next === 'popup' ? 'ui.html?surface=popup' : '' });
  await browser.sidePanel!.setPanelBehavior({ openPanelOnActionClick: next === 'sidebar' });
}
export const displayReady = (async () => {
  const saved = (await browser.storage.local.get('walletDisplayMode')).walletDisplayMode;
  if (supported && (saved === 'popup' || saved === 'sidebar')) mode = saved;
  await apply(mode);
})();
export const displayStatus = () => ({ mode, sidebar: supported });
let changing = false;
export async function setDisplayMode(next: unknown) {
  await displayReady;
  if (!supported || (next !== 'sidebar' && next !== 'popup') || changing)
    throw Error('Display mode unavailable');
  changing = true;
  const previous = mode;
  try {
    await apply(next);
    await browser.storage.local.set({ walletDisplayMode: next });
    mode = next;
  } catch (error) {
    await apply(previous);
    throw error;
  } finally {
    changing = false;
  }
  return displayStatus();
}
