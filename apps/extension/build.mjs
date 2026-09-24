import { policy } from '../native/src/pq/checkpoint.ts';
import { rulesHash } from '../native/src/pq/node.ts';
import { DEV_RUNTIME_HASH, DEVELOPMENT, mainnetProfile } from '../native/src/network.ts';
import { licenseNotices } from './licenses.mjs';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile, writeFile, copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
// Trusted public pins are embedded at build time, never accepted from an API/dapp.
const networkName = process.env.QLYPHS_EXTENSION_NETWORK ?? 'development';
if (!['development', 'mainnet', 'switchable'].includes(networkName))
  throw Error('QLYPHS_EXTENSION_NETWORK must be development, mainnet or switchable');
// `switchable`: both networks compiled in, the user picks one in Settings. Not a store build: it
// keeps the development identity, so it installs over a development wallet and keeps its data.
const switchable = networkName === 'switchable';
const mainnet = networkName === 'mainnet';
const withMainnet = mainnet || switchable;
// The mainnet lock: no pins file, no mainnet (or switchable) build.
if (withMainnet && !process.env.QLYPHS_EXTENSION_PINS)
  throw Error('A mainnet build requires QLYPHS_EXTENSION_PINS (genesis, runtime and activation pins)');
if (!withMainnet && process.env.QLYPHS_EXTENSION_PINS)
  throw Error('QLYPHS_EXTENSION_PINS is only read with QLYPHS_EXTENSION_NETWORK=mainnet');
const pins = withMainnet ? JSON.parse(await readFile(process.env.QLYPHS_EXTENSION_PINS, 'utf8')) : null;
const mainnetPins = withMainnet ? mainnetProfile(pins) : null;
const profile = withMainnet ? mainnetPins : DEVELOPMENT;
if (withMainnet && process.env.NATIVE_PQ_POLICY_FILE)
  throw Error('PQ witnesses are not validated on mainnet yet; build without NATIVE_PQ_POLICY_FILE');
if (
  switchable &&
  ['QLYPHS_EXTENSION_API', 'QLYPHS_EXTENSION_RPC', 'QLYPHS_EXTENSION_EXPLORER', 'QLYPHS_EXTENSION_DAPP_ORIGINS'].some(
    (name) => process.env[name] !== undefined,
  )
)
  throw Error('A switchable build uses the default endpoints of each network; unset QLYPHS_EXTENSION_* overrides');
const pqPolicy = process.env.NATIVE_PQ_POLICY_FILE
  ? policy(JSON.parse(await readFile(process.env.NATIVE_PQ_POLICY_FILE, 'utf8')))
  : null;
if (
  pqPolicy &&
  (pqPolicy.rulesHash !== rulesHash() ||
    pqPolicy.runtimeHash !== DEV_RUNTIME_HASH ||
    pqPolicy.activation.height !== 0 ||
    pqPolicy.activation.hash !== pqPolicy.genesis)
)
  throw Error('PQ policy does not match the installed development protocol/runtime');
const STORE_SUMMARY =
  'Self-custody wallet for Quantus. Hold and send QTC, and review every transaction before you sign it.';
if (STORE_SUMMARY.length > 132) throw Error('Store summary exceeds 132 characters');
const require = createRequire(import.meta.url);
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const dist = process.env.QLYPHS_EXTENSION_OUTPUT ?? 'dist';
if (!/^dist(?:-[a-z0-9-]+)?$/.test(dist))
  throw Error('Build output must be a local dist directory');
const api = process.env.QLYPHS_EXTENSION_API ?? (withMainnet ? 'https://app.qlyphs.com' : 'http://127.0.0.1:4400');
const explorer =
  process.env.QLYPHS_EXTENSION_EXPLORER ??
  (withMainnet ? 'https://qlyphs.com/explorer' : 'http://localhost:3000/explorer');
const explorerURL = new URL(explorer);
if (explorerURL.username || explorerURL.password || explorerURL.search || explorerURL.hash ||
    !(explorerURL.protocol === 'https:' || (explorerURL.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(explorerURL.hostname))))
  throw Error('Explorer must be an HTTPS URL or a local HTTP URL without credentials, query or fragment');
if (withMainnet && explorerURL.protocol !== 'https:') throw Error('A mainnet explorer must be an HTTPS URL');
const rpc = process.env.QLYPHS_EXTENSION_RPC ?? (withMainnet ? 'https://rpc1-mainnet.quantus.com' : 'http://127.0.0.1:9955');
const dapps = process.env.QLYPHS_EXTENSION_DAPP_ORIGINS
  ? JSON.parse(process.env.QLYPHS_EXTENSION_DAPP_ORIGINS)
  : withMainnet
    ? // The QLYP app and the OTC (deposits from, withdrawals to the wallet).
      ['https://app.qlyphs.com', 'https://otc.qlyphs.com']
    : [
        api,
        'http://127.0.0.1:4401',
        'http://127.0.0.1:4402',
        'http://127.0.0.1:4403',
        // The OTC app in development (`pnpm dev` serves it on localhost:3001; 3101 for a second copy).
        'http://localhost:3001',
        'http://localhost:3101',
      ];
if (
  !Array.isArray(dapps) ||
  dapps.length < 1 ||
  dapps.length > 16 ||
  dapps.some((origin) => typeof origin !== 'string') ||
  new Set(dapps).size !== dapps.length
)
  throw Error(`Dapp origins must be a unique list of 1 to 16 exact ${networkName} origins`);
function checkOrigins(mainnet, values) {
 for (const value of values) {
  const u = new URL(value);
  if (mainnet) {
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.pathname !== '/' ||
      u.search ||
      u.hash ||
      value !== u.origin ||
      ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    )
      throw Error('This mainnet build only accepts exact public HTTPS origins without a trailing slash');
    continue;
  }
  if (
    u.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash ||
    value.endsWith('/')
  )
    throw Error(
      'This development build only accepts exact loopback HTTP origins without a trailing slash',
    );
}
}
checkOrigins(withMainnet, [api, rpc, ...dapps]);
// Both networks' endpoints, each checked by its own rules (loopback HTTP / public HTTPS).
const DEV_DAPPS = [
  'http://127.0.0.1:4400',
  'http://127.0.0.1:4401',
  'http://127.0.0.1:4402',
  'http://127.0.0.1:4403',
  'http://localhost:3001',
  'http://localhost:3101',
];
const networks = switchable
  ? {
      development: {
        api: 'http://127.0.0.1:4400',
        rpc: 'http://127.0.0.1:9955',
        dapps: DEV_DAPPS,
        explorer: 'http://localhost:3000/explorer',
        profile: DEVELOPMENT,
      },
      mainnet: { api, rpc, dapps, explorer, profile: mainnetPins },
    }
  : null;
if (networks) checkOrigins(false, [networks.development.api, networks.development.rpc, ...networks.development.dapps]);
const everyApi = networks ? [networks.mainnet.api, networks.development.api] : [api];
const everyRpc = networks ? [networks.mainnet.rpc, networks.development.rpc] : [rpc];
const everyDapp = networks ? [...new Set([...networks.mainnet.dapps, ...networks.development.dapps])] : dapps;
const sdkDir = dirname(require.resolve('@quantus-network/wasm/package.json'));
const sdk = JSON.parse(await readFile(resolve(sdkDir, 'package.json'), 'utf8'));
if (sdk.version !== '0.3.1')
  throw Error(
    'SDK changed; revalidate legacy derivation and regenerate matching glue before building',
  );
const binary = await readFile(resolve(sdkDir, 'pkg/quantus_wasm_bg.wasm'));
const binaryHash = createHash('sha256').update(binary).digest('hex');
// Development pins a stable id with a local key; the store assigns the mainnet id.
const { key } = JSON.parse(await readFile('development-key.json', 'utf8'));
const chromeId = [
  ...createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32),
]
  .map((x) => String.fromCharCode(97 + parseInt(x, 16)))
  .join('');
const hosts = [
  ...new Set(
    [...everyApi, ...everyRpc].map((x) => {
      const u = new URL(x);
      return `${u.protocol}//${u.hostname}/*`;
    }),
  ),
];
const matches = [
  ...new Set(
    everyDapp.map((value) => {
      const u = new URL(value);
      return `${u.protocol}//${u.hostname}/*`;
    }),
  ),
];
await rm(dist, { recursive: true, force: true });
for (const target of ['chrome', 'firefox']) {
  const outdir = `${dist}/${target}`;
  await mkdir(outdir, { recursive: true });
  const shared = {
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    outdir,
    legalComments: 'eof',
    define: {
      QLYPHS_VERSION: JSON.stringify(version),
      QLYPHS_API: JSON.stringify(api),
      QLYPHS_RPC: JSON.stringify(rpc),
      QLYPHS_DAPP_ORIGINS: JSON.stringify(dapps),
      QLYPHS_EXPLORER: JSON.stringify(explorer),
      QLYPHS_PQ_POLICY: JSON.stringify(pqPolicy),
      QLYPHS_NETWORK_PROFILE: JSON.stringify(profile),
      QLYPHS_NETWORKS: JSON.stringify(networks),
    },
    logLevel: 'info',
  };
  const meta = await build({
    ...shared,
    entryPoints: {
      background: 'src/background.ts',
      ui: 'src/ui.ts',
      explorer: 'src/explorer.ts',
    },
    format: 'esm',
    metafile: true,
  });
  await build({
    ...shared,
    entryPoints: { content: 'src/content.ts', provider: 'src/provider.ts' },
    format: 'iife',
  });
  for (const name of [
    'ui.html',
    'style.css',
    'controls.css',
    'explorer.html',
    'explorer.css',
    ...[16, 32, 48, 128].map((n) => `icon-${n}.png`),
  ])
    await copyFile(`public/${name}`, `${outdir}/${name}`);
  const geistDir = resolve(dirname(require.resolve('geist/font/sans')), '..');
  for (const [family, file] of [
    ['geist-sans', 'Geist-Variable.woff2'],
    ['geist-mono', 'GeistMono-Variable.woff2'],
  ])
    await copyFile(resolve(geistDir, 'dist/fonts', family, file), `${outdir}/${file}`);
  await copyFile(resolve(geistDir, 'LICENSE.txt'), `${outdir}/GEIST-LICENSE.txt`);
  await writeFile(`${outdir}/quantus_wasm_bg.wasm`, binary);
  const manifest = {
    manifest_version: 3,
    name: mainnet ? 'Qlyphs Wallet' : switchable ? 'Qlyphs Wallet (Mainnet + Development)' : 'Qlyphs Wallet (Development)',
    version,
    description: mainnet
      ? STORE_SUMMARY
      : switchable
        ? 'Quantus wallet for mainnet and the development network, switched in Settings.'
        : 'Non-custodial development wallet for Quantus and Qlyphs assets. Mainnet disabled.',
    permissions: ['storage', 'alarms', ...(target === 'chrome' ? ['sidePanel'] : [])],
    optional_permissions: ['notifications'],
    host_permissions: hosts,
    action: {
      ...(target === 'firefox' ? { default_popup: 'ui.html?surface=popup' } : {}),
      default_title: mainnet ? 'Qlyphs Wallet' : switchable ? 'Qlyphs Wallet' : 'Qlyphs Wallet · Development',
    },
    ...(target === 'chrome' ? { side_panel: { default_path: 'ui.html?surface=sidebar' } } : {}),
    icons: Object.fromEntries([16, 32, 48, 128].map((n) => [String(n), `icon-${n}.png`])),
    content_scripts: [
      {
        matches,
        js: ['content.js'],
        run_at: 'document_start',
        all_frames: false,
        world: 'ISOLATED',
      },
      {
        matches,
        js: ['provider.js'],
        run_at: 'document_start',
        all_frames: false,
        world: 'MAIN',
      },
    ],
    content_security_policy: {
      extension_pages: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' ${[...new Set([...everyApi, ...everyRpc])].join(' ')}; base-uri 'none'; frame-ancestors 'none'`,
    },
    ...(target === 'chrome'
      ? {
          minimum_chrome_version: '124',
          ...(mainnet ? {} : { key }),
          background: { service_worker: 'background.js', type: 'module' },
        }
      : {
          background: {
            scripts: ['background.js'],
            type: 'module',
            persistent: false,
          },
          browser_specific_settings: {
            gecko: {
              id: mainnet ? 'wallet@qlyphs.com' : 'wallet-dev@qlyphs.com',
              strict_min_version: '140.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }),
  };
  await writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  for (const name of ['background', 'ui', 'explorer', 'content', 'provider']) {
    const source = await readFile(`${outdir}/${name}.js`, 'utf8');
    if (/\beval\s*\(|new\s+Function\s*\(|\bimport\s*\(/.test(source))
      throw Error(`Unexpected dynamic code in ${name}`);
  }
  await writeFile(
    `${outdir}/BUILD.json`,
    JSON.stringify(
      {
        version,
        sdk: '@quantus-network/wasm@0.3.1',
        wasmSHA256: binaryHash,
        api,
        rpc,
        explorer,
        ...(mainnet ? { network: 'mainnet', pins: profile } : { chromeId }),
        ...(switchable ? { network: 'switchable', pins: mainnetPins, networks } : {}),
        dappOrigins: everyDapp,
        providerProtocolVersion: 2,
        pqPolicyVersion: pqPolicy?.version ?? null,
        pqRulesHash: pqPolicy?.rulesHash ?? null,
        format: 'QLYP-v1',
        scheme: 'ml-dsa-87',
        derivation: "m/44'/189189'/0'/0'/0'",
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    `${dist}/${target}-bundle-meta.json`,
    JSON.stringify(meta.metafile, null, 2) + '\n',
  );
  // License text is packaged with the code, not fetched at extension runtime.
  const license = await readFile(resolve(sdkDir, 'LICENSE'), 'utf8').catch(() => null);
  if (!license) throw Error('Missing Quantus SDK license; review distribution before packaging');
  await writeFile(`${outdir}/QUANTUS-LICENSE.txt`, license);
  await writeFile(
    `${outdir}/THIRD-PARTY-LICENSES.txt`,
    await licenseNotices(meta.metafile, sdkDir),
  );
}
if (!mainnet) console.log(`Chrome development origin: chrome-extension://${chromeId}`);
