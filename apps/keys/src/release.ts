/** The identity of this Keys build that its pages and wallet worker compare with each other. */
declare const QLYPHS_BUILD: string | undefined;
/** Set by build.mjs; a bundle built without it (tests) compares versions only. */
export const BUILD_ID: string | null = typeof QLYPHS_BUILD === 'string' ? QLYPHS_BUILD : null;
const VERSION: string = typeof QLYPHS_VERSION === 'string' ? QLYPHS_VERSION : 'unversioned';
/** The version alone does not change between builds of one release, the build id does. */
export const RELEASE: string = BUILD_ID ? `${VERSION}+${BUILD_ID}` : VERSION;
/** How long a check of the live build may take before it is skipped. */
const CHECK_MS = 3000;
/**
 * Whether keys.qlyphs.com now serves another build than the one running here: a window or worker
 * that stayed open across a release. BUILD.json is the release's own manifest. Any doubt (no build
 * id here, a failed read) answers false: this check only decides when to offer a reload and is never
 * a security boundary.
 */
export async function newerBuildLive(): Promise<boolean> {
  if (!BUILD_ID) return false;
  try {
    const response = await fetch(new URL('/BUILD.json', location.origin), {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(CHECK_MS),
    });
    if (!response.ok) return false;
    const build = ((await response.json()) as { build?: unknown } | null)?.build;
    return typeof build === 'string' && /^[0-9a-f]{16}$/.test(build) && build !== BUILD_ID;
  } catch {
    return false;
  }
}
