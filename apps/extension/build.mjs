import { policy } from '../native/src/pq/checkpoint.ts';
import { rulesHash } from '../native/src/pq/node.ts';
import { DEV_RUNTIME_HASH, DEVELOPMENT, mainnetProfile, progressiveRules } from '../native/src/network.ts';
import { mainnetReviewed, mainnetRules } from '../../packages/native/src/protocol.ts';
import { base58, SOLANA_VAULT_DEPLOYMENTS } from '../../packages/provider/src/solana-vault.ts';
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
// Solana vault signing is a development feature: only the fixed development build serves it.
const solanaVault = networkName === 'development';
// A development build may also sign for a wQTC program on Solana devnet: both its program id and its
// mint, base58, or neither. Other builds refuse the variables rather than ignore them.
const WQTC_ENV = ['QLYPHS_EXTENSION_WQTC_PROGRAM', 'QLYPHS_EXTENSION_WQTC_MINT'];
const wqtcNamed = WQTC_ENV.filter((name) => process.env[name] !== undefined);
if (wqtcNamed.length && !solanaVault)
  throw Error('QLYPHS_EXTENSION_WQTC_* is only read by a development build');
if (wqtcNamed.length && wqtcNamed.length !== WQTC_ENV.length)
  throw Error(
    'A wQTC deployment names both QLYPHS_EXTENSION_WQTC_PROGRAM and QLYPHS_EXTENSION_WQTC_MINT',
  );
/** A Solana address, base58 in its one canonical spelling, as 0x + 64 lowercase hex. */
function solanaAddress(name) {
  const text = process.env[name];
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const c of text) {
    const digit = ALPHABET.indexOf(c);
    if (digit < 0) throw Error(`${name} is not base58`);
    n = n * 58n + BigInt(digit);
  }
  const bytes = new Uint8Array(32);
  for (let i = 31; i >= 0; i--, n >>= 8n) bytes[i] = Number(n & 0xffn);
  if (n !== 0n || base58(bytes) !== text || bytes.every((x) => x === 0))
    throw Error(`${name} is not a 32-byte Solana address`);
  return '0x' + Buffer.from(bytes).toString('hex');
}
const wqtc = wqtcNamed.length
  ? {
      program: solanaAddress('QLYPHS_EXTENSION_WQTC_PROGRAM'),
      mint: solanaAddress('QLYPHS_EXTENSION_WQTC_MINT'),
    }
  : null;
if (
  wqtc &&
  (wqtc.program === wqtc.mint || SOLANA_VAULT_DEPLOYMENTS.some((d) => d.program === wqtc.program))
)
  throw Error('The wQTC program is its own program, distinct from the vault program and the mint');
const mainnet = networkName === 'mainnet';
const withMainnet = mainnet || switchable;
// A switchable build may replace the local development network with a public test network. It keeps
// the development profile, so it never signs for the mainnet genesis, and it has no defaults: all
// four endpoints are named, reached over public HTTPS, and none is a mainnet service or dapp.
const TESTNET_ENV = [
  'QLYPHS_EXTENSION_TESTNET_API',
  'QLYPHS_EXTENSION_TESTNET_RPC',
  'QLYPHS_EXTENSION_TESTNET_EXPLORER',
  'QLYPHS_EXTENSION_TESTNET_DAPP_ORIGINS',
];
const testnetNamed = TESTNET_ENV.filter((name) => process.env[name] !== undefined);
if (testnetNamed.length && !switchable)
  throw Error('QLYPHS_EXTENSION_TESTNET_* is only read with QLYPHS_EXTENSION_NETWORK=switchable');
if (testnetNamed.length && testnetNamed.length !== TESTNET_ENV.length)
  throw Error(
    `A testnet names all its endpoints; missing ${TESTNET_ENV.filter((name) => !testnetNamed.includes(name)).join(', ')}`,
  );
const testnet = testnetNamed.length > 0;
// The store build: mainnet plus the public test network (hidden until the user shows test networks),
// under the store identity. It carries each network's own witness policy.
const store = process.env.QLYPHS_EXTENSION_STORE === '1';
if (store && !(switchable && testnet))
  throw Error('QLYPHS_EXTENSION_STORE needs QLYPHS_EXTENSION_NETWORK=switchable and a public testnet');
const storeIdentity = mainnet || store;
// The mainnet lock: no pins file, no mainnet (or switchable) build.
if (withMainnet && !process.env.QLYPHS_EXTENSION_PINS)
  throw Error('A mainnet build requires QLYPHS_EXTENSION_PINS (genesis, runtime and activation pins)');
if (!withMainnet && process.env.QLYPHS_EXTENSION_PINS)
  throw Error('QLYPHS_EXTENSION_PINS is only read with QLYPHS_EXTENSION_NETWORK=mainnet');
const pins = withMainnet ? JSON.parse(await readFile(process.env.QLYPHS_EXTENSION_PINS, 'utf8')) : null;
const mainnetPins = withMainnet ? mainnetProfile(pins) : null;
const profile = withMainnet ? mainnetPins : DEVELOPMENT;
// A mainnet wallet carries a witness policy only once the progressive and fee activation is
// reviewed. A switchable build's policy is a development one: the wallet uses it on that network
// only, and the policy's genesis binds it there too.
if (mainnet && process.env.NATIVE_PQ_POLICY_FILE && !mainnetReviewed())
  throw Error('PQ witnesses are not validated on mainnet yet; build without NATIVE_PQ_POLICY_FILE');
if (
  switchable &&
  ['QLYPHS_EXTENSION_API', 'QLYPHS_EXTENSION_RPC', 'QLYPHS_EXTENSION_EXPLORER', 'QLYPHS_EXTENSION_DAPP_ORIGINS'].some(
    (name) => process.env[name] !== undefined,
  )
)
  throw Error('A switchable build uses the default endpoints of each network; unset QLYPHS_EXTENSION_* overrides');
// The development rules the witnesses run; their fee schedule is compiled in (QLYPHS_FEE_RULES) so
// the wallet prices with the schedule its policy binds. Mainnet reads only the reviewed release.
if (mainnet && process.env.NATIVE_FEE_SCHEDULE)
  throw Error('A mainnet build takes its fee schedule from the reviewed release; unset NATIVE_FEE_SCHEDULE');
const developmentRules = mainnet
  ? null
  : progressiveRules(
      'development',
      process.env.NATIVE_PROGRESSIVE_FROM,
      process.env.NATIVE_PROGRESSIVE_V2_FROM,
      process.env.NATIVE_FEE_SCHEDULE,
    );
const feeRules = developmentRules?.feeSchedule ?? null;
const pqPolicyBytes = process.env.NATIVE_PQ_POLICY_FILE
  ? await readFile(process.env.NATIVE_PQ_POLICY_FILE)
  : null;
const pqPolicy = pqPolicyBytes ? policy(JSON.parse(pqPolicyBytes.toString('utf8'))) : null;
// Lets a reviewer match BUILD.json to the exact policy file, e.g. deploy/mainnet/witness-policy.json.
const pqPolicySHA256 = pqPolicyBytes
  ? createHash('sha256').update(pqPolicyBytes).digest('hex')
  : null;
if (
  pqPolicy &&
  mainnet &&
  // The mainnet policy binds the pinned network and the reviewed progressive activation.
  (pqPolicy.genesis !== mainnetPins.genesis ||
    pqPolicy.activation.height !== mainnetPins.activation.height ||
    pqPolicy.activation.hash !== mainnetPins.activation.hash ||
    pqPolicy.runtimeHash !== mainnetPins.runtime.codeHash ||
    pqPolicy.rulesHash !== rulesHash(undefined, mainnetRules()) ||
    process.env.NATIVE_PROGRESSIVE_FROM ||
    process.env.NATIVE_PROGRESSIVE_V2_FROM ||
    process.env.NATIVE_FEE_SCHEDULE)
)
  throw Error('PQ policy does not match the mainnet pins and the reviewed protocol');
if (
  pqPolicy &&
  !mainnet &&
  // The policy binds the witnesses' progressive activations and fee schedule too.
  (pqPolicy.rulesHash !== rulesHash(undefined, developmentRules) ||
    pqPolicy.runtimeHash !== DEV_RUNTIME_HASH ||
    pqPolicy.activation.height !== 0 ||
    pqPolicy.activation.hash !== pqPolicy.genesis)
)
  throw Error('PQ policy does not match the installed development protocol/runtime');
// A switchable build may also carry the reviewed mainnet policy, used on mainnet only.
const mainnetPolicyBytes = process.env.NATIVE_PQ_POLICY_FILE_MAINNET
  ? await readFile(process.env.NATIVE_PQ_POLICY_FILE_MAINNET)
  : null;
if (mainnetPolicyBytes && !switchable)
  throw Error('NATIVE_PQ_POLICY_FILE_MAINNET is only read with QLYPHS_EXTENSION_NETWORK=switchable');
const mainnetPolicy = mainnetPolicyBytes ? policy(JSON.parse(mainnetPolicyBytes.toString('utf8'))) : null;
if (
  mainnetPolicy &&
  (mainnetPolicy.genesis !== mainnetPins.genesis ||
    mainnetPolicy.activation.height !== mainnetPins.activation.height ||
    mainnetPolicy.activation.hash !== mainnetPins.activation.hash ||
    mainnetPolicy.runtimeHash !== mainnetPins.runtime.codeHash ||
    mainnetPolicy.rulesHash !== rulesHash(undefined, mainnetRules()))
)
  throw Error('Mainnet PQ policy does not match the mainnet pins and the reviewed protocol');
const pqPolicies = mainnetPolicy ? { mainnet: mainnetPolicy, ...(pqPolicy ? { development: pqPolicy } : {}) } : null;
const STORE_SUMMARY =
  'Self-custody wallet for Quantus. Hold and send QTC, and review every transaction before you sign it.';
if (STORE_SUMMARY.length > 132) throw Error('Store summary exceeds 132 characters');
const require = createRequire(import.meta.url);
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const dist = process.env.QLYPHS_EXTENSION_OUTPUT ?? 'dist';
if (!/^dist(?:-[a-z0-9-]+)?$/.test(dist))
  throw Error('Build output must be a local dist directory');
const api = process.env.QLYPHS_EXTENSION_API ?? (withMainnet ? 'https://indexer.qlyphs.com' : 'http://127.0.0.1:4400');
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
    ? // The Qlyphs sites: the QLYP app first (also the platform origin), then the OTC and the others.
      [
        'https://app.qlyphs.com',
        'https://otc.qlyphs.com',
        'https://qlyphs.com',
        'https://www.qlyphs.com',
        'https://street.qlyphs.com',
        'https://city.qlyphs.com',
        'https://docs.qlyphs.com',
        'https://reserve.qlyphs.com',
        'https://graduation.qlyphs.com',
      ]
    : [
        api,
        'http://127.0.0.1:4401',
        'http://127.0.0.1:4402',
        'http://127.0.0.1:4403',
        // The OTC app in development (`pnpm dev` serves it on localhost:3001; 3101 for a second copy).
        'http://localhost:3001',
        'http://localhost:3101',
      ];
const checkList = (list, name) => {
  if (
    !Array.isArray(list) ||
    list.length < 1 ||
    list.length > 16 ||
    list.some((origin) => typeof origin !== 'string') ||
    new Set(list).size !== list.length
  )
    throw Error(`Dapp origins must be a unique list of 1 to 16 exact ${name} origins`);
};
checkList(dapps, networkName);
// The Qlyphs app: the wallet reads only token logos from it, and opens its token pages. It must be
// one of the dapp origins, so the wallet never reaches a host the listing does not already name.
const platformOf = (list, override) => {
  const value = override ?? list.find((o) => /^https:\/\/app\./.test(o) || o === 'http://127.0.0.1:4403') ?? list[0];
  if (!list.includes(value)) throw Error(`The Qlyphs app origin must be one of the dapp origins: ${value}`);
  return value;
};
const platform = platformOf(dapps, process.env.QLYPHS_EXTENSION_PLATFORM);
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
// With a testnet, the development side of a switchable build is that public network instead.
const development = testnet
  ? {
      api: process.env.QLYPHS_EXTENSION_TESTNET_API,
      rpc: process.env.QLYPHS_EXTENSION_TESTNET_RPC,
      dapps: JSON.parse(process.env.QLYPHS_EXTENSION_TESTNET_DAPP_ORIGINS),
      platform: process.env.QLYPHS_EXTENSION_TESTNET_PLATFORM,
      explorer: process.env.QLYPHS_EXTENSION_TESTNET_EXPLORER,
      profile: DEVELOPMENT,
      testnet: true,
    }
  : {
      api: 'http://127.0.0.1:4400',
      rpc: 'http://127.0.0.1:9955',
      dapps: DEV_DAPPS,
      platform: 'http://127.0.0.1:4403',
      explorer: 'http://localhost:3000/explorer',
      profile: DEVELOPMENT,
      testnet: false,
    };
const networks = switchable
  ? { development, mainnet: { api, rpc, dapps, platform, explorer, profile: mainnetPins, testnet: false } }
  : null;
if (networks) {
  checkList(development.dapps, testnet ? 'testnet' : 'development');
  development.platform = platformOf(development.dapps, development.platform);
  checkOrigins(testnet, [development.api, development.rpc, ...development.dapps]);
}
if (testnet) {
  const u = new URL(development.explorer);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash)
    throw Error('A testnet explorer must be an HTTPS URL without credentials, query or fragment');
  // A testnet wallet stays apart from mainnet: none of its services or dapps.
  const mainnetOrigins = [api, rpc, ...dapps];
  for (const value of [development.api, development.rpc, ...development.dapps])
    if (mainnetOrigins.includes(value)) throw Error(`A testnet cannot use the mainnet origin ${value}`);
}
const everyApi = networks ? [networks.mainnet.api, networks.development.api] : [api];
const everyRpc = networks ? [networks.mainnet.rpc, networks.development.rpc] : [rpc];
const everyDapp = networks ? [...new Set([...networks.mainnet.dapps, ...networks.development.dapps])] : dapps;
const everyPlatform = networks ? [networks.mainnet.platform, networks.development.platform] : [platform];
// Endpoints the user may set (Settings → Network → Edit, endpoints.ts), in a development build only:
// any HTTPS host, and hosts on this machine, where its network runs. The CSP cannot list hosts chosen
// at run time, so this widens connect-src; a build with mainnet keeps it to the compiled hosts, so
// nothing running in its pages can reach any other. The browser asks the user for each host
// (optional host permissions) before the wallet can reach it.
const customEndpoints = !withMainnet;
const customHosts = customEndpoints ? ['https://*/*', 'http://127.0.0.1/*', 'http://localhost/*'] : [];
const customConnect = customEndpoints ? ['https:', 'http://127.0.0.1:*', 'http://localhost:*'] : [];
// The QTC price in US dollars (src/qtc-price.ts): CoinGecko's public API answers any origin, so it
// needs no host permission, only this connect-src entry. Display only, and off in Settings.
const priceOrigin = 'https://api.coingecko.com';
const sdkDir = dirname(require.resolve('@quantus-network/wasm/package.json'));
const sdk = JSON.parse(await readFile(resolve(sdkDir, 'package.json'), 'utf8'));
if (sdk.version !== '1.0.0')
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
    [...everyApi, ...everyRpc, ...everyPlatform].map((x) => {
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
      QLYPHS_PLATFORM: JSON.stringify(platform),
      QLYPHS_PQ_POLICY: JSON.stringify(pqPolicy),
      QLYPHS_PQ_POLICIES: JSON.stringify(pqPolicies),
      QLYPHS_FEE_RULES: JSON.stringify(feeRules),
      QLYPHS_NETWORK_PROFILE: JSON.stringify(profile),
      QLYPHS_NETWORKS: JSON.stringify(networks),
      QLYPHS_CUSTOM_ENDPOINTS: JSON.stringify(customEndpoints),
      QLYPHS_SOLANA_VAULT: JSON.stringify(solanaVault),
      QLYPHS_SOLANA_WQTC: JSON.stringify(wqtc),
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
    name: storeIdentity
      ? 'Qlyphs Wallet'
      : switchable
        ? `Qlyphs Wallet (Mainnet + ${testnet ? 'Testnet' : 'Development'})`
        : 'Qlyphs Wallet (Development)',
    version,
    description: storeIdentity
      ? STORE_SUMMARY
      : switchable
        ? `Quantus wallet for mainnet and the ${testnet ? 'test' : 'development'} network, switched in Settings.`
        : 'Non-custodial development wallet for Quantus and Qlyphs assets. Mainnet disabled.',
    permissions: ['storage', 'alarms', ...(target === 'chrome' ? ['sidePanel'] : [])],
    optional_permissions: ['notifications'],
    host_permissions: hosts,
    ...(customEndpoints ? { optional_host_permissions: customHosts } : {}),
    action: {
      ...(target === 'firefox' ? { default_popup: 'ui.html?surface=popup' } : {}),
      default_title: storeIdentity || switchable ? 'Qlyphs Wallet' : 'Qlyphs Wallet · Development',
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
      extension_pages: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' ${[...new Set([...everyApi, ...everyRpc, ...everyPlatform, priceOrigin, ...customConnect])].join(' ')}; base-uri 'none'; frame-ancestors 'none'`,
    },
    ...(target === 'chrome'
      ? {
          minimum_chrome_version: '124',
          ...(storeIdentity ? {} : { key }),
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
              id: storeIdentity ? 'wallet@qlyphs.com' : 'wallet-dev@qlyphs.com',
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
        sdk: '@quantus-network/wasm@1.0.0',
        wasmSHA256: binaryHash,
        api,
        rpc,
        explorer,
        platform,
        ...(mainnet ? { network: 'mainnet', pins: profile } : store ? {} : { chromeId }),
        ...(switchable ? { network: 'switchable', pins: mainnetPins, networks } : {}),
        ...(store ? { store: true } : {}),
        ...(mainnetPolicyBytes
          ? {
              pqPolicyMainnetVersion: mainnetPolicy.version,
              pqPolicyMainnetSHA256: createHash('sha256').update(mainnetPolicyBytes).digest('hex'),
            }
          : {}),
        dappOrigins: everyDapp,
        providerProtocolVersion: 2,
        pqPolicyVersion: pqPolicy?.version ?? null,
        pqRulesHash: pqPolicy?.rulesHash ?? null,
        pqPolicySHA256,
        ...(solanaVault ? { developmentFeatures: ['solanaVault'] } : {}),
        ...(wqtc
          ? {
              solanaWqtc: {
                program: process.env.QLYPHS_EXTENSION_WQTC_PROGRAM,
                mint: process.env.QLYPHS_EXTENSION_WQTC_MINT,
              },
            }
          : {}),
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
if (!storeIdentity) console.log(`Chrome development origin: chrome-extension://${chromeId}`);
