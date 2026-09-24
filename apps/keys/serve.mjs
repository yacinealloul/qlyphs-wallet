/** Static server for dist/keys and dist/demo. No dependencies, allowlisted files only. */
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here = dirname(fileURLToPath(import.meta.url));
const keysDir = resolve(here, 'dist/keys');
const demoDir = resolve(here, 'dist/demo');
const build = JSON.parse(await readFile(resolve(keysDir, 'BUILD.json'), 'utf8'));
const { api, rpc, keysOrigin } = build;
// Serve exactly the release: every file in dist/keys must be listed in SHA256SUMS.txt with the
// same hash, and nothing else may be there. A drifted or tampered file stops the server.
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sums = await readFile(resolve(keysDir, 'SHA256SUMS.txt'), 'utf8');
const listed = new Map(sums.trimEnd().split('\n').map((line) => [line.slice(66), line.slice(0, 64)]));
const present = (await readdir(keysDir)).filter((name) => name !== 'SHA256SUMS.txt');
for (const name of new Set([...present, ...listed.keys()]))
  if (!present.includes(name) || listed.get(name) !== sha256(await readFile(resolve(keysDir, name))))
    throw Error(`dist/keys does not match SHA256SUMS.txt: ${name}`);
const release = sha256(sums);
const connect = (build.connectOrigins ?? [api, rpc]).join(' ');
const KEYS_PORT = Number(process.env.KEYS_PORT ?? new URL(keysOrigin).port ?? 4410) || 4410;
const DEMO_PORT = Number(process.env.DEMO_PORT ?? 4411);
const LISTEN = process.env.KEYS_LISTEN ?? 'localhost';
const https = keysOrigin.startsWith('https:');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const page = (ancestors) =>
  `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' ${connect}; worker-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors ${ancestors}`;
const keysHeaders = (name) => {
  const h = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'x-qlyphs-release': release,
    // No COOP: it would sever window.opener, which the dapp bridge needs.
  };
  if (https) h['strict-transport-security'] = 'max-age=63072000; includeSubDomains';
  if (name === 'ui.html') {
    // 'self' framing is only for the confirmation overlay; nothing else is served here.
    h['content-security-policy'] = page("'self'");
    h['x-frame-options'] = 'SAMEORIGIN';
  } else if (name === 'connect.html') {
    h['content-security-policy'] = page("'none'");
    h['x-frame-options'] = 'DENY';
  } else if (name.endsWith('.js'))
    h['content-security-policy'] = `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' ${connect}`;
  else h['content-security-policy'] = "default-src 'none'; frame-ancestors 'none'";
  return h;
};
const demoHeaders = () => ({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'",
});
async function serve(dir, port, host, route, headers) {
  const files = new Set((await readdir(dir, { withFileTypes: true })).filter((f) => f.isFile()).map((f) => f.name));
  createServer(async (req, res) => {
    try {
      if (req.headers.host !== host) return end(res, 421);
      if (req.method !== 'GET' && req.method !== 'HEAD') return end(res, 405, { allow: 'GET, HEAD' });
      const url = new URL(req.url ?? '/', 'http://' + host);
      const target = route(url);
      if (target?.redirect) return end(res, 301, { ...headers(''), location: target.redirect });
      const name = target?.file ?? url.pathname.slice(1);
      if (!target?.file && name.endsWith('.html')) return end(res, 404, headers(''));
      // Allowlist lookup only; the URL is never joined onto a path.
      if (!files.has(name) || !types[extname(name)]) return end(res, 404, headers(''));
      const body = await readFile(resolve(dir, name));
      res.writeHead(200, { ...headers(name), 'content-type': types[extname(name)], 'content-length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      end(res, 500);
    }
  }).listen(port, LISTEN, () => console.log(`http://${host}/ → ${dir}`));
}
function end(res, status, headers = {}) {
  res.writeHead(status, headers);
  res.end();
}
await serve(
  keysDir,
  KEYS_PORT,
  process.env.KEYS_HOST ?? new URL(keysOrigin).host,
  // Clean paths: / is the wallet, /connect?origin=<dapp> the dapp popup. Old .html links still land.
  (url) => {
    if (url.pathname === '/') return { file: 'ui.html' };
    if (url.pathname === '/connect') return { file: 'connect.html' };
    if (url.pathname === '/ui.html') return { redirect: '/' + url.search };
    if (url.pathname === '/connect.html') return { redirect: '/connect' + url.search };
    return null;
  },
  keysHeaders,
);
if (!https)
  await serve(demoDir, DEMO_PORT, process.env.DEMO_HOST ?? `localhost:${DEMO_PORT}`,
    (url) => (url.pathname === '/' ? { file: 'demo.html' } : null), demoHeaders);
