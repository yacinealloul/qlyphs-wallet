import { KEYS_CHANNEL } from './protocol.ts';
// Runs before ui.ts: a confirmation overlay closes by asking its host page.
if (window.top !== window)
  window.close = () => parent.postMessage({ channel: KEYS_CHANNEL, type: 'close' }, location.origin);
// The wallet lives at a bare /, which on the web is always the full tab. ui.ts reads the
// surface synchronously on load, so it is shown the param and the address bar gets it back.
if (window.top === window && ['', '?surface=tab'].includes(location.search)) {
  history.replaceState(null, '', '/?surface=tab');
  setTimeout(() => history.replaceState(null, '', '/'));
}
