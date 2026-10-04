/** Which browsers Qlyphs Keys runs mint sessions in: desktop Chromium-family or desktop Firefox on
 * Windows, macOS or Linux, with one wallet worker shared by every Keys page. */

/** What the decision reads from a page's or the wallet worker's `navigator`. Every field exists in
 * both, so a dapp page and the wallet worker in the same browser decide from the same signals. */
export interface BrowserFacts {
  /** The wallet runs in a SharedWorker (in a page: the browser offers SharedWorker). */
  shared: boolean;
  userAgent: string;
  /** `navigator.platform`. */
  platform: string;
  /** `navigator.userAgentData`, which Chromium browsers expose in secure contexts. */
  userAgentData?: {
    brands?: readonly { brand?: unknown }[];
    mobile?: unknown;
    platform?: unknown;
  } | null;
}

// A session is a sequence of signatures that runs while the user waits, so it is offered only where
// its lifecycle was tested: a shared worker that outlives any single page, and a desktop browser.
// Mobile browsers freeze background tabs and popups. WebKit (Safari, and every browser on iOS) and
// the single-page dedicated-worker fallback are not tested with sessions. Anything unrecognised, and
// any signal that disagrees with another, is refused.
//
// Android browsers can present a desktop identity: Chrome on Android XR headsets and desktop Android
// devices, and any Android browser with 'Desktop site' on. Chrome on desktop Android devices reports
// itself exactly as ChromeOS does, so ChromeOS is refused too. In the other cases navigator.platform
// still says 'Linux armv81', in pages and in workers, which is how a dapp page in a desktop-mode tab
// reaches the same answer as the wallet worker, which never sees the tab's override. High-entropy
// client hints such as formFactors are not read: they only arrive asynchronously, and both contexts
// decide synchronously.
const REFUSED =
  /Android|Mobi|Tablet|iPhone|iPad|iPod|CriOS|FxiOS|EdgiOS|OPiOS|CrOS|OculusBrowser|PicoBrowser|\bQuest\b|\bVR\b|\bXR\b/;

type System = 'windows' | 'mac' | 'linux';
// The values Chromium (reduced) and Firefox report on each desktop system, whatever the CPU.
const PLATFORM_SYSTEM = new Map<unknown, System>([
  ['Win32', 'windows'],
  ['MacIntel', 'mac'],
  ['Linux x86_64', 'linux'],
]);
const USER_AGENT_DATA_SYSTEM = new Map<unknown, System>([
  ['Windows', 'windows'],
  ['macOS', 'mac'],
  ['Linux', 'linux'],
]);
const USER_AGENT_SYSTEM: [RegExp, System][] = [
  [/Windows NT/, 'windows'],
  [/Macintosh/, 'mac'],
  [/\bLinux\b/, 'linux'],
];

/** The one desktop system the user agent string names, or undefined for none or several. */
function userAgentSystem(userAgent: string): System | undefined {
  const named = USER_AGENT_SYSTEM.filter(([pattern]) => pattern.test(userAgent));
  return named.length === 1 ? named[0]?.[1] : undefined;
}

export function sessionsSupported(facts: BrowserFacts): boolean {
  const { shared, userAgent, platform, userAgentData } = facts;
  if (shared !== true || typeof userAgent !== 'string' || REFUSED.test(userAgent)) return false;
  const system = PLATFORM_SYSTEM.get(platform);
  if (!system || userAgentSystem(userAgent) !== system) return false;
  if (userAgentData) {
    // Chromium reports its engine and form factor here, independently of the user agent string.
    const brands = Array.isArray(userAgentData.brands) ? userAgentData.brands : [];
    return (
      userAgentData.mobile === false &&
      USER_AGENT_DATA_SYSTEM.get(userAgentData.platform) === system &&
      brands.some((b) => b?.brand === 'Chromium')
    );
  }
  // Without userAgentData only Firefox (Gecko) is recognised. A Chrome user agent string without
  // userAgentData is refused: WebKit browsers can present one.
  return (
    /\bGecko\/\d/.test(userAgent) &&
    /\bFirefox\/\d/.test(userAgent) &&
    !/AppleWebKit|Chrome\//.test(userAgent)
  );
}

interface NavigatorLike {
  userAgent?: unknown;
  platform?: unknown;
  userAgentData?: BrowserFacts['userAgentData'];
}
function facts(shared: boolean): BrowserFacts {
  const nav = (globalThis as { navigator?: NavigatorLike }).navigator;
  return {
    shared,
    userAgent: typeof nav?.userAgent === 'string' ? nav.userAgent : '',
    platform: typeof nav?.platform === 'string' ? nav.platform : '',
    userAgentData: nav?.userAgentData ?? null,
  };
}

/** The wallet worker's own facts: it is shared only when `scope` is a SharedWorker's global. */
export function workerFacts(scope: unknown): BrowserFacts {
  const Scope = (globalThis as { SharedWorkerGlobalScope?: unknown }).SharedWorkerGlobalScope;
  return facts(typeof Scope === 'function' && scope instanceof Scope);
}

/** A page's facts about its browser, for a dapp deciding what to offer. The same browser gives the
 * same answer, also with a per-tab desktop mode on; only a user agent override that also replaces
 * navigator.platform, such as developer tools emulation, can make the two differ. */
export function pageFacts(): BrowserFacts {
  return facts(typeof (globalThis as { SharedWorker?: unknown }).SharedWorker === 'function');
}
