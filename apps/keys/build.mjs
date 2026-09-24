import { policy } from '../native/src/pq/checkpoint.ts';
import { rulesHash } from '../native/src/pq/node.ts';
import { DEV_RUNTIME_HASH, DEVELOPMENT, mainnetProfile } from '../native/src/network.ts';
import { licenseNotices } from '../extension/licenses.mjs';
import { createRequire } from 'node:module';
import { readFile, writeFile, copyFile, mkdir, rm, readdir } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
// The unchanged extension sources are built for the web; only three modules are swapped.
const here = dirname(fileURLToPath(import.meta.url));
process.chdir(here);
// No install of our own: esbuild, geist and the wasm SDK come from the extension's tree.
const require = createRequire(new URL('../extension/package.json', import.meta.url));
const { build } = require('esbuild');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const profile = process.env.QLYPHS_KEYS_PROFILE ?? 'development';
if (!['development', 'production'].includes(profile))
  throw Error('QLYPHS_KEYS_PROFILE must be development or production');
const production = profile === 'production';
// Mirrors apps/extension/build.mjs QLYPHS_EXTENSION_NETWORK. A production (public HTTPS) keys build
// is mainnet only; development serves on localhost and may sign for either network.
const networkName = process.env.QLYPHS_KEYS_NETWORK ?? (production ? 'mainnet' : 'development');
if (!['development', 'mainnet', 'switchable'].includes(networkName))
  throw Error('QLYPHS_KEYS_NETWORK must be development, mainnet or switchable');
if (production && networkName !== 'mainnet')
  throw Error('A production keys build is mainnet only; the development network is local');
const switchable = networkName === 'switchable';
const mainnet = networkName === 'mainnet';
const withMainnet = mainnet || switchable;
// Trusted public pins are embedded at build time, never accepted from an API/dapp. The mainnet
// lock: no pins file, no mainnet (or switchable) build.
if (withMainnet && !process.env.QLYPHS_KEYS_PINS)
  throw Error('A mainnet build requires QLYPHS_KEYS_PINS (genesis, runtime and activation pins)');
if (!withMainnet && process.env.QLYPHS_KEYS_PINS)
  throw Error('QLYPHS_KEYS_PINS is only read with QLYPHS_KEYS_NETWORK=mainnet or switchable');
const mainnetPins = withMainnet
  ? mainnetProfile(JSON.parse(await readFile(process.env.QLYPHS_KEYS_PINS, 'utf8')))
  : null;
const networkProfile = withMainnet ? mainnetPins : DEVELOPMENT;
if (withMainnet && process.env.NATIVE_PQ_POLICY_FILE)
  throw Error('PQ witnesses are not validated on mainnet yet; build without NATIVE_PQ_POLICY_FILE');
if (
  switchable &&
  ['QLYPHS_KEYS_API', 'QLYPHS_KEYS_RPC', 'QLYPHS_KEYS_EXPLORER', 'QLYPHS_KEYS_DAPP_ORIGINS'].some(
    (name) => process.env[name] !== undefined,
  )
)
  throw Error('A switchable build uses the default endpoints of each network; unset QLYPHS_KEYS_* overrides');
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
const env = (name, fallback) => process.env[name] ?? fallback;
// Same defaults as the extension: hosted services on mainnet, local ones on development.
const MAINNET_DEFAULTS = {
  api: 'https://app.qlyphs.com',
  rpc: 'https://rpc1-mainnet.quantus.com',
  explorer: 'https://qlyphs.com/explorer',
  dapps: ['https://otc.qlyphs.com'],
};
const demoOrigin = 'http://localhost:4411';
const DEV_DEFAULTS = {
  api: 'http://127.0.0.1:4400',
  rpc: 'http://127.0.0.1:9955',
  explorer: 'http://localhost:3000/explorer',
  dapps: ['http://127.0.0.1:4400', 'http://127.0.0.1:4401', 'http://127.0.0.1:4402', 'http://127.0.0.1:4403',
    'http://localhost:3001', 'http://127.0.0.1:3001', demoOrigin],
};
const defaults = withMainnet ? MAINNET_DEFAULTS : DEV_DEFAULTS;
const api = env('QLYPHS_KEYS_API', defaults.api);
const rpc = env('QLYPHS_KEYS_RPC', defaults.rpc);
const explorer = env('QLYPHS_KEYS_EXPLORER', defaults.explorer);
const keysOrigin = env('QLYPHS_KEYS_ORIGIN', production ? 'https://keys.qlyphs.com' : 'http://localhost:4410');
const dapps = process.env.QLYPHS_KEYS_DAPP_ORIGINS
  ? JSON.parse(process.env.QLYPHS_KEYS_DAPP_ORIGINS)
  : withMainnet
    ? defaults.dapps
    : // The API origin serves the QLYP app in development.
      [...new Set([api, ...defaults.dapps])];
const loopback = ['localhost', '127.0.0.1', '[::1]'];
const exact = (value) => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
};
const isLoopbackHttp = (value) => exact(value) && value.startsWith('http:') && loopback.includes(new URL(value).hostname);
const isPublicHttps = (value) => exact(value) && value.startsWith('https:') && !loopback.includes(new URL(value).hostname);
const checkList = (list) => {
  if (
    !Array.isArray(list) ||
    list.length < 1 ||
    list.length > 16 ||
    list.some((origin) => typeof origin !== 'string') ||
    new Set(list).size !== list.length ||
    list.includes(keysOrigin)
  )
    throw Error('Dapp origins must be a unique list of 1 to 16 exact origins, excluding the keys origin');
};
// Endpoints follow the network (mainnet: public HTTPS; development: loopback HTTP), dapps too.
const checkNetwork = (onMainnet, values) => {
  for (const value of values)
    if (!(onMainnet ? isPublicHttps(value) : isLoopbackHttp(value)))
      throw Error(
        onMainnet
          ? `A mainnet build only accepts exact public HTTPS origins: ${value}`
          : `A development build only accepts exact loopback HTTP origins: ${value}`,
      );
};
checkList(dapps);
checkNetwork(withMainnet, [api, rpc, ...dapps]);
if (!(production ? isPublicHttps(keysOrigin) : isLoopbackHttp(keysOrigin)))
  throw Error(`The ${profile} keys origin must be an exact ${production ? 'public HTTPS' : 'loopback HTTP'} origin`);
if (!production && new URL(keysOrigin).hostname === '127.0.0.1')
  throw Error('Use localhost for the keys origin: an IP address is not a valid passkey rpId');
const checkExplorer = (value, onMainnet) => {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash ||
      !(u.protocol === 'https:' || (!onMainnet && u.protocol === 'http:' && loopback.includes(u.hostname))))
    throw Error(`Explorer must be an HTTPS URL${onMainnet ? '' : ' or a local HTTP URL'} without credentials, query or fragment`);
};
checkExplorer(explorer, withMainnet);
// `switchable`: both networks compiled in, the user picks one in Settings (config.ts). Local only.
const networks = switchable
  ? {
      development: {
        api: DEV_DEFAULTS.api,
        rpc: DEV_DEFAULTS.rpc,
        dapps: DEV_DEFAULTS.dapps,
        explorer: DEV_DEFAULTS.explorer,
        profile: DEVELOPMENT,
      },
      mainnet: { api, rpc, dapps, explorer, profile: mainnetPins },
    }
  : null;
if (networks) {
  checkList(networks.development.dapps);
  checkNetwork(false, [networks.development.api, networks.development.rpc, ...networks.development.dapps]);
}
const everyApi = networks ? [networks.mainnet.api, networks.development.api] : [api];
const everyRpc = networks ? [networks.mainnet.rpc, networks.development.rpc] : [rpc];
const everyDapp = networks ? [...new Set([...networks.mainnet.dapps, ...networks.development.dapps])] : dapps;
if (everyDapp.length > 16) throw Error('At most 16 dapp origins across networks');
// The pages and the worker call the API and the RPC cross-origin (the extension skips CORS through
// host_permissions; a web page cannot). A mainnet endpoint that does not answer a CORS preflight for
// the keys origin leaves every status, fee, review and submit call failing, so a production build
// refuses it and any other mainnet build warns. apps/native only allows the origins it is told to.
// QLYPHS_KEYS_SKIP_CORS_CHECK=1 skips it (offline build); the deploy must then check it by hand.
const corsProblem = async (endpoint, path) => {
  try {
    const url = new URL(path, endpoint);
    const pre = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: keysOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
      signal: AbortSignal.timeout(10_000),
    });
    const allow = pre.headers.get('access-control-allow-origin');
    if (!pre.ok || !(allow === keysOrigin || allow === '*'))
      return `preflight ${url} from ${keysOrigin} answered ${pre.status}, allow-origin ${allow ?? 'none'}`;
    return null;
  } catch (error) {
    return `preflight ${endpoint} failed: ${error.message}`;
  }
};
if (withMainnet) {
  const mainnetApi = networks ? networks.mainnet.api : api;
  const mainnetRpc = networks ? networks.mainnet.rpc : rpc;
  if (process.env.QLYPHS_KEYS_SKIP_CORS_CHECK === '1')
    console.warn(`WARNING: CORS check skipped; verify ${mainnetApi} and ${mainnetRpc} allow ${keysOrigin} before deploying`);
  else {
    const problems = (await Promise.all([corsProblem(mainnetApi, '/api/status'), corsProblem(mainnetRpc, '/')])).filter(Boolean);
    if (problems.length) {
      const text = `Qlyphs Keys at ${keysOrigin} cannot reach its mainnet endpoints:\n  ${problems.join('\n  ')}\n` +
        `The API must allow this exact origin (apps/native accepts only extension origins today).`;
      if (production) throw Error(text);
      console.warn('WARNING: ' + text);
    }
  }
}
const sdkDir = dirname(require.resolve('@quantus-network/wasm/package.json'));
const sdk = JSON.parse(await readFile(resolve(sdkDir, 'package.json'), 'utf8'));
if (sdk.version !== '0.3.1')
  throw Error(
    'SDK changed; revalidate legacy derivation and regenerate matching glue before building',
  );
const binary = await readFile(resolve(sdkDir, 'pkg/quantus_wasm_bg.wasm'));
const binaryHash = createHash('sha256').update(binary).digest('hex');

const ext = resolve(here, '../extension/src');
const own = resolve(here, 'src');
const swap = (map) => ({
  name: 'keys-swap',
  setup(b) {
    b.onResolve({ filter: /^\.\/(browser|passkeys)\.ts$/ }, (args) => {
      if (args.importer.startsWith(own + sep)) return undefined;
      const abs = resolve(args.resolveDir, args.path);
      for (const [name, file] of Object.entries(map))
        if (abs === resolve(ext, name)) return { path: resolve(own, file) };
      return undefined;
    });
  },
});
const define = {
  QLYPHS_VERSION: JSON.stringify(version),
  QLYPHS_API: JSON.stringify(api),
  QLYPHS_RPC: JSON.stringify(rpc),
  QLYPHS_DAPP_ORIGINS: JSON.stringify(dapps),
  QLYPHS_EXPLORER: JSON.stringify(explorer),
  QLYPHS_PQ_POLICY: JSON.stringify(pqPolicy),
  QLYPHS_KEYS_ORIGIN: JSON.stringify(keysOrigin),
  QLYPHS_NETWORK_PROFILE: JSON.stringify(networkProfile),
  QLYPHS_NETWORKS: JSON.stringify(networks),
  // What the dapp SDK reports until the wallet names its network (a switchable build starts on mainnet).
  QLYPHS_KEYS_NETWORK: JSON.stringify(withMainnet ? 'mainnet' : 'development'),
};
const shared = {
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  legalComments: 'eof',
  define,
  metafile: true,
  logLevel: 'info',
};
const dist = resolve(here, 'dist');
const out = resolve(dist, 'keys');
const demo = resolve(dist, 'demo');
await rm(dist, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await mkdir(demo, { recursive: true });
const bundles = [
  ['background', 'src/worker.ts', { 'browser.ts': 'web-browser.ts' }],
  ['ui', 'src/ui-entry.ts', { 'browser.ts': 'page-browser.ts', 'passkeys.ts': 'passkeys.ts' }],
  ['connect', 'src/connect.ts', { 'browser.ts': 'page-browser.ts' }],
];
const metas = [];
for (const [name, entry, map] of bundles) {
  const { metafile } = await build({
    ...shared,
    entryPoints: { [name]: entry },
    outdir: out,
    plugins: [swap(map)],
  });
  const inputs = Object.keys(metafile.inputs).map((x) => resolve(here, x));
  for (const banned of ['browser.ts', 'passkeys.ts', ...(name === 'background' ? ['ui.ts'] : [])])
    if (inputs.includes(resolve(ext, banned)))
      throw Error(`${name}.js must not include extension/src/${banned}`);
  metas.push(metafile);
}
for (const [file, dir] of [['sdk', dist], ['sdk', demo], ['demo', demo]]) {
  const { metafile } = await build({ ...shared, entryPoints: { [file]: `src/${file}.ts` }, outdir: dir });
  if (Object.keys(metafile.inputs).some((x) => resolve(here, x).startsWith(ext + sep)))
    throw Error(`${file}.js must not include extension sources`);
}
for (const name of ['style.css', 'controls.css', ...[16, 32, 48, 128].map((n) => `icon-${n}.png`)])
  await copyFile(`../extension/public/${name}`, `${out}/${name}`);
for (const name of ['keys.css', 'connect.html']) await copyFile(`public/${name}`, `${out}/${name}`);
for (const name of ['demo.html', 'demo.css']) await copyFile(`public/${name}`, `${demo}/${name}`);
const geistDir = resolve(dirname(require.resolve('geist/font/sans')), '..');
for (const [family, file] of [
  ['geist-sans', 'Geist-Variable.woff2'],
  ['geist-mono', 'GeistMono-Variable.woff2'],
])
  await copyFile(resolve(geistDir, 'dist/fonts', family, file), `${out}/${file}`);
await copyFile(resolve(geistDir, 'LICENSE.txt'), `${out}/GEIST-LICENSE.txt`);
await writeFile(`${out}/quantus_wasm_bg.wasm`, binary);
let html = await readFile('../extension/public/ui.html', 'utf8');
for (const [from, to] of [
  // A switchable build drops the suffix at runtime on mainnet (network-copy.ts).
  ['<title>Qlyphs Wallet · Development</title>', mainnet ? '<title>Qlyphs Keys</title>' : '<title>Qlyphs Keys · Development</title>'],
  [
    '<link rel="stylesheet" href="controls.css" />',
    '<link rel="stylesheet" href="controls.css" />\n    <link rel="stylesheet" href="keys.css" />\n    <link rel="icon" href="icon-32.png" />',
  ],
  [
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
  ],
  ['Continues in a dedicated extension tab.', 'Continues in a dedicated tab.'],
  ['Only visible in this extension.', 'Only visible in this browser.'],
]) {
  if (html.split(from).length !== 2) throw Error(`ui.html changed; expected exactly one: ${from}`);
  html = html.replace(from, to);
}
await writeFile(`${out}/ui.html`, html);
for (const dir of [out, demo, dist])
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.js'))) {
    const source = await readFile(resolve(dir, name), 'utf8');
    if (/\beval\s*\(|new\s+Function\s*\(|\bimport\s*\(/.test(source))
      throw Error(`Unexpected dynamic code in ${relative(here, resolve(dir, name))}`);
  }
const license = await readFile(resolve(sdkDir, 'LICENSE'), 'utf8').catch(() => null);
if (!license) throw Error('Missing Quantus SDK license; review distribution before packaging');
await writeFile(`${out}/QUANTUS-LICENSE.txt`, license);
await writeFile(
  `${out}/THIRD-PARTY-LICENSES.txt`,
  await licenseNotices({ outputs: Object.assign({}, ...metas.map((m) => m.outputs)) }, sdkDir),
);
await writeFile(
  `${out}/BUILD.json`,
  JSON.stringify(
    {
      version,
      profile,
      network: networkName,
      ...(withMainnet ? { pins: mainnetPins } : {}),
      ...(networks ? { networks } : {}),
      sdk: '@quantus-network/wasm@0.3.1',
      wasmSHA256: binaryHash,
      api,
      rpc,
      explorer,
      keysOrigin,
      dappOrigins: everyDapp,
      // Every endpoint a page may reach on any compiled network (serve.mjs CSP connect-src).
      connectOrigins: [...new Set([...everyApi, ...everyRpc])],
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
// Release manifest: one SHA-256 per served file, sorted, in `shasum -a 256` format. The build is
// deterministic, so anyone rebuilding this commit gets the same lines; the release hash is the
// SHA-256 of this file and names the whole release in one value (README.md, Verify a release).
const served = (await readdir(out)).sort();
const sums = [];
for (const name of served)
  sums.push(`${createHash('sha256').update(await readFile(`${out}/${name}`)).digest('hex')}  ${name}\n`);
await writeFile(`${out}/SHA256SUMS.txt`, sums.join(''));
const releaseHash = createHash('sha256').update(sums.join('')).digest('hex');
console.log(`Qlyphs Keys (${profile}, ${networkName}) built for ${keysOrigin}`);
console.log(`Release hash (SHA-256 of SHA256SUMS.txt): ${releaseHash}`);
