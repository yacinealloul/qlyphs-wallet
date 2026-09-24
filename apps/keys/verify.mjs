#!/usr/bin/env node
/** Checks that a live Qlyphs Keys site serves exactly a published release. No dependencies.
 *
 *   node verify.mjs [origin] [--expect <release hash>] [--local <dir containing SHA256SUMS.txt>]
 *
 * 1. Downloads SHA256SUMS.txt from the site and computes the release hash (its SHA-256).
 * 2. Downloads every listed file and checks its SHA-256 against the list.
 * 3. Checks the wallet page's Content-Security-Policy only runs same-origin scripts, so the
 *    listed files are all the code the page can execute.
 * 4. With --expect, the release hash must equal the published one; with --local, the list must
 *    equal the one from your own build of the same commit (README.md, Verify a release).
 * Exit code 0 only when every check passes. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) throw Error(`${name} needs a value`);
  args.splice(i, 2);
  return value;
};
const expect = option('--expect')?.toLowerCase();
const local = option('--local');
const origin = new URL(args[0] ?? 'https://keys.qlyphs.com').origin;
if (expect !== undefined && !/^[0-9a-f]{64}$/.test(expect)) throw Error('--expect takes a 64-character SHA-256 hex');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Pages are served on clean paths; every other file at its own name.
const pathOf = (name) => (name === 'ui.html' ? '/' : name === 'connect.html' ? '/connect' : '/' + name);
const get = async (path) => {
  const res = await fetch(origin + path, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw Error(`${path} answered ${res.status}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers };
};
let failures = 0;
const ok = (text) => console.log(`  ok    ${text}`);
const fail = (text) => {
  failures++;
  console.log(`  FAIL  ${text}`);
};
const parse = (text) => {
  const lines = text.split('\n').filter(Boolean);
  const map = new Map();
  for (const line of lines) {
    const m = /^([0-9a-f]{64}) {2}([A-Za-z0-9._-]+)$/.exec(line);
    if (!m || map.has(m[2])) throw Error(`Malformed SHA256SUMS.txt line: ${line}`);
    map.set(m[2], m[1]);
  }
  return map;
};

console.log(`Verifying ${origin}\n`);
const sumsFile = await get('/SHA256SUMS.txt');
const sums = sumsFile.bytes.toString('utf8');
const release = sha256(sumsFile.bytes);
const listed = parse(sums);
console.log(`Release hash  ${release}`);
console.log(`Files listed  ${listed.size}\n`);

console.log('Served files match SHA256SUMS.txt');
for (const [name, hash] of listed) {
  try {
    const actual = sha256((await get(pathOf(name))).bytes);
    if (actual === hash) ok(`${name}  ${hash.slice(0, 16)}…`);
    else fail(`${name}  listed ${hash.slice(0, 16)}…, served ${actual.slice(0, 16)}…`);
  } catch (error) {
    fail(`${name}  ${error.message}`);
  }
}

console.log('\nThe wallet page can only run those files');
const csp = (await get('/')).headers.get('content-security-policy') ?? '';
const directive = (name) =>
  csp.split(';').map((d) => d.trim().split(/\s+/)).find(([key]) => key === name)?.slice(1) ?? null;
const only = (name, allowed) => {
  const values = directive(name);
  if (values && values.length && values.every((v) => allowed.includes(v))) ok(`${name} ${values.join(' ')}`);
  else fail(`${name} is ${values ? values.join(' ') || 'empty' : 'missing'}; expected only ${allowed.join(' ')}`);
};
only('default-src', ["'none'"]);
only('script-src', ["'self'", "'wasm-unsafe-eval'"]);
only('worker-src', ["'self'"]);
only('base-uri', ["'none'"]);

if (expect !== undefined) {
  console.log('\nRelease hash matches the published one');
  if (release === expect) ok(expect);
  else fail(`published ${expect}, served ${release}`);
}
if (local !== undefined) {
  console.log(`\nSHA256SUMS.txt matches your build (${local})`);
  const mine = parse(await readFile(resolve(local, 'SHA256SUMS.txt'), 'utf8'));
  for (const name of new Set([...mine.keys(), ...listed.keys()]))
    if (mine.get(name) === listed.get(name)) ok(name);
    else fail(`${name}  yours ${mine.get(name)?.slice(0, 16) ?? 'absent'}, served ${listed.get(name)?.slice(0, 16) ?? 'absent'}`);
}

console.log(
  failures
    ? `\n${failures} check(s) failed. Do not use this site until you know why.`
    : `\nAll checks passed. ${origin} serves release ${release}.`,
);
process.exit(failures ? 1 : 0);
