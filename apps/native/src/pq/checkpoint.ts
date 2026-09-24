/** QPA1 attestations. Public-key verification only: signing keys never enter this module.
 * This is a signed operator claim, NOT a consensus or storage proof. */
import { sha512 } from '@noble/hashes/sha2.js';
import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import {
  decode,
  encode,
  fromHex,
  hex,
  parseCall,
  callBytes,
  MAX_U128,
  MAX_U64,
  ZERO,
  requireThat,
} from '../../../../packages/native/src/codec.ts';
import {
  assertInvariants,
  buyCall,
  FIRST_INSCRIPTION,
  INSCRIPTION_DEFINITION,
  MAINNET,
  PROTOCOL_LABEL,
  QLYPHS_FEE_ACCOUNT,
  saleFee,
} from '../../../../packages/native/src/protocol.ts';
import type {
  Asset,
  Inscription,
  State,
  Ticket,
} from '../../../../packages/native/src/protocol.ts';

export const MAX_PROOF_BYTES = 16 * 1024 * 1024;
export const MAX_ENTRIES = 100000;
export const MAX_TTL_MS = 60000;
export const PROTOCOL = PROTOCOL_LABEL;
const enc = new TextEncoder();
export function canonical(value: unknown, depth = 0): string {
  requireThat(depth < 24, 'canonical depth limit');
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    requireThat(value.length <= MAX_PROOF_BYTES, 'string limit');
    // All protocol text is ASCII; reject lone surrogates even in future extensions.
    requireThat(!/[\uD800-\uDFFF]/u.test(value), 'surrogate not allowed');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    requireThat(
      Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0),
      'unsafe integer',
    );
    return String(value);
  }
  if (Array.isArray(value)) {
    requireThat(value.length <= MAX_ENTRIES, 'array limit');
    return '[' + value.map((x) => canonical(x, depth + 1)).join(',') + ']';
  }
  requireThat(
    value &&
      typeof value === 'object' &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null),
    'plain object required',
  );
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  requireThat(
    keys.length <= 32 && !keys.some((k) => ['__proto__', 'constructor', 'prototype'].includes(k)),
    'object keys',
  );
  return (
    '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(o[k], depth + 1)).join(',') + '}'
  );
}
export const hash512 = (domain: string, value: unknown): string =>
  hex(sha512(enc.encode(domain + '\0' + canonical(value))));
export const keyId = (publicKey: string): string => {
  fromHex(publicKey, 2592);
  return hash512('Qlyphs/QPA1/key', publicKey);
};
export const object = (v: unknown, fields: string[]): Record<string, unknown> => {
  requireThat(v && typeof v === 'object' && !Array.isArray(v), 'object required');
  const o = v as Record<string, unknown>;
  requireThat(
    Object.keys(o).length === fields.length && fields.every((k) => Object.hasOwn(o, k)),
    'unexpected/missing fields',
  );
  return o;
};
export const natural = (v: unknown, max = Number.MAX_SAFE_INTEGER): number => {
  requireThat(
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max && !Object.is(v, -0),
    'integer required',
  );
  return v;
};
export const identifier = (v: unknown, bytes = 32): string => {
  requireThat(typeof v === 'string', 'identifier required');
  fromHex(v, bytes);
  return v;
};
const money = (v: unknown, max = MAX_U128): bigint => {
  requireThat(
    typeof v === 'string' && /^(0|[1-9][0-9]{0,38})$/.test(v),
    'canonical amount required',
  );
  const n = BigInt(v);
  requireThat(n <= max, 'amount overflow');
  return n;
};
const list = (v: unknown): unknown[] => {
  requireThat(Array.isArray(v) && v.length <= MAX_ENTRIES, 'list required');
  return v;
};
const sorted = <T>(xs: T[], key: (x: T) => string): T[] => {
  let prev: string | undefined;
  for (const x of xs) {
    const k = key(x);
    requireThat(prev === undefined || prev < k, 'duplicate/unsorted key');
    prev = k;
  }
  return xs;
};
export interface Snapshot {
  format: 1;
  height: number;
  hash: string;
  assets: { id: string; creator: string; definition: string; minted: string }[];
  balances: { key: string; amount: string }[];
  sequences: { owner: string; value: string }[];
  multisigs: { id: string; threshold: number; signers: string[] }[];
  tickets: {
    key: string;
    multisig: string;
    proposal: number;
    seller: string;
    callHex: string;
    createdHeight: number;
    status: string;
    settlement: string | null;
  }[];
  /** Unique symbols, sorted by symbol. */
  symbols: { symbol: string; asset: string }[];
  /** Inscriptions sorted by number; content as 0x-prefixed hex. */
  inscriptions: {
    number: number;
    id: string;
    creator: string;
    contentType: string;
    content: string;
    height: number;
    index: number;
  }[];
  nextInscription: number;
}
/** Canonical definition bytes of an asset, normalized to sequence 0: the DEPLOY payload, or the
 * INSCRIBE payload for an inscription. */
function definitionHex(a: Asset, genesis: string, ins: Inscription | undefined): string {
  const d = a.definition;
  if (d.policy === 'inscription') {
    requireThat(ins, 'inscription asset without inscription');
    return hex(
      encode({
        genesis,
        sequence: 0n,
        op: { kind: 'inscribe', contentType: ins.contentType, content: ins.content },
      }),
    );
  }
  return hex(encode({ genesis, sequence: 0n, op: { ...d, policy: d.policy } }));
}
/** Journal text / insertion order / provisional heads are deliberately not consensus state. */
export function snapshot(s: State, genesis: string): Snapshot {
  requireThat(s.height === s.finalized, 'finalized state required');
  const pairs = <T>(m: Map<string, T>) => [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    format: 1,
    height: s.height,
    hash: s.hash,
    assets: pairs(s.assets).map(([id, a]) => ({
      id,
      creator: a.creator,
      definition: definitionHex(a, genesis, s.inscriptions.get(id)),
      minted: String(a.minted),
    })),
    balances: pairs(s.balances)
      .filter(([, n]) => n > 0n)
      .map(([key, n]) => ({ key, amount: String(n) })),
    sequences: pairs(s.sequences).map(([owner, n]) => ({ owner, value: String(n) })),
    multisigs: pairs(s.multisigs).map(([id, m]) => ({
      id,
      threshold: m.threshold,
      signers: [...m.signers].sort(),
    })),
    tickets: pairs(s.tickets).map(([key, t]) => ({
      key,
      multisig: t.multisig,
      proposal: t.proposal,
      seller: t.seller,
      callHex: t.callHex,
      createdHeight: t.createdHeight,
      status: t.status,
      settlement: t.settlement ?? null,
    })),
    symbols: pairs(s.symbols).map(([symbol, asset]) => ({ symbol, asset })),
    inscriptions: [...s.inscriptions.values()]
      .sort((a, b) => a.number - b.number)
      .map((x) => ({
        number: x.number,
        id: x.id,
        creator: x.creator,
        contentType: x.contentType,
        content: x.content,
        height: x.height,
        index: x.index,
      })),
    nextInscription: s.nextInscription,
  };
}
/** Decode an authenticated snapshot defensively. Never use an unsigned API checkpoint. */
export function snapshotState(input: unknown, genesis: string): State {
  const v = object(input, [
    'format',
    'height',
    'hash',
    'assets',
    'balances',
    'sequences',
    'multisigs',
    'tickets',
    'symbols',
    'inscriptions',
    'nextInscription',
  ]);
  requireThat(v.format === 1 && genesis !== MAINNET, 'unsupported snapshot/network');
  const height = natural(v.height, 0xffffffff);
  const s: State = {
    height,
    finalized: height,
    hash: identifier(v.hash),
    sequences: new Map(),
    assets: new Map(),
    balances: new Map(),
    multisigs: new Map(),
    tickets: new Map(),
    symbols: new Map(),
    inscriptions: new Map(),
    nextInscription: natural(v.nextInscription),
    journal: [],
  };
  requireThat(s.nextInscription >= FIRST_INSCRIPTION, 'inscription counter');
  /** INSCRIBE definitions by asset id: the inscriptions list must match them exactly. */
  const definitions = new Map<string, { contentType: string; content: string }>();
  let count = 0;
  for (const k of [
    'assets',
    'balances',
    'sequences',
    'multisigs',
    'tickets',
    'symbols',
    'inscriptions',
  ])
    count += list(v[k]).length;
  requireThat(count <= MAX_ENTRIES, 'snapshot capacity');
  for (const x of sorted(
    list(v.assets).map((x) => object(x, ['id', 'creator', 'definition', 'minted'])),
    (x) => identifier(x.id, 40),
  )) {
    const id = identifier(x.id, 40),
      creator = identifier(x.creator);
    requireThat(creator !== ZERO && id.startsWith(creator), 'asset identity');
    const definition = decode(fromHex(String(x.definition)));
    const op = definition.op;
    requireThat(
      definition.genesis === genesis &&
        definition.sequence === 0n &&
        (op.kind === 'deploy' || op.kind === 'inscribe'),
      'asset definition',
    );
    if (op.kind === 'inscribe') definitions.set(id, op);
    s.assets.set(id, {
      creator,
      definition: op.kind === 'inscribe' ? { ...INSCRIPTION_DEFINITION } : op,
      minted: money(x.minted),
    });
  }
  for (const x of sorted(
    list(v.balances).map((x) => object(x, ['key', 'amount'])),
    (x) => String(x.key),
  )) {
    requireThat(
      typeof x.key === 'string' && /^0x[0-9a-f]{80}:0x[0-9a-f]{64}$/.test(x.key),
      'balance key',
    );
    requireThat(
      s.assets.has(x.key.slice(0, 82)) && x.key.slice(83) !== ZERO,
      'unknown asset/zero holder',
    );
    const n = money(x.amount);
    requireThat(n > 0n, 'zero balances omitted');
    s.balances.set(x.key, n);
  }
  for (const x of sorted(
    list(v.sequences).map((x) => object(x, ['owner', 'value'])),
    (x) => identifier(x.owner),
  )) {
    const n = money(x.value, MAX_U64);
    requireThat(n > 0n && x.owner !== ZERO, 'invalid sequence');
    s.sequences.set(identifier(x.owner), n);
  }
  for (const x of sorted(
    list(v.multisigs).map((x) => object(x, ['id', 'threshold', 'signers'])),
    (x) => identifier(x.id),
  )) {
    const signers = sorted(
        list(x.signers).map((x) => identifier(x)),
        (x) => x,
      ),
      threshold = natural(x.threshold, signers.length);
    requireThat(signers.length > 0 && signers.length <= 100 && threshold > 0, 'invalid multisig');
    s.multisigs.set(identifier(x.id), { threshold, signers });
  }
  for (const x of sorted(
    list(v.tickets).map((x) =>
      object(x, [
        'key',
        'multisig',
        'proposal',
        'seller',
        'callHex',
        'createdHeight',
        'status',
        'settlement',
      ]),
    ),
    (x) => String(x.key),
  )) {
    const multisig = identifier(x.multisig),
      proposal = natural(x.proposal, 0xffffffff),
      seller = identifier(x.seller);
    requireThat(
      x.key === `${multisig}:${proposal}` && s.multisigs.has(multisig),
      'invalid ticket identity',
    );
    requireThat(typeof x.callHex === 'string', 'ticket call required');
    const call = parseCall(fromHex(x.callHex));
    requireThat(call.kind === 'remark' && !call.event, 'invalid offer call');
    const e = decode(fromHex(call.payload));
    requireThat(
      e.genesis === genesis && e.op.kind === 'offer' && s.assets.has(e.op.asset),
      'invalid offer',
    );
    requireThat(
      e.op.fee === saleFee(e.op.price) && e.op.feeTo === QLYPHS_FEE_ACCOUNT,
      'offer without the Qlyphs sale fee',
    );
    const createdHeight = natural(x.createdHeight, height);
    requireThat(['locked', 'settled', 'released'].includes(String(x.status)), 'ticket status');
    requireThat((x.status === 'settled') === (x.settlement !== null), 'settlement status');
    if (x.settlement !== null) identifier(x.settlement);
    if (x.status === 'locked') requireThat(height <= e.op.expiry, 'expired live reservation');
    const t: Ticket = {
      key: String(x.key),
      multisig,
      proposal,
      seller,
      callHex: x.callHex,
      createdHeight,
      status: x.status as Ticket['status'],
      offer: e.op,
      ...(x.settlement !== null ? { settlement: String(x.settlement) } : {}),
    };
    s.tickets.set(t.key, t);
  }
  for (const x of sorted(
    list(v.symbols).map((x) => object(x, ['symbol', 'asset'])),
    (x) => String(x.symbol),
  )) {
    requireThat(typeof x.symbol === 'string' && /^[A-Z0-9]{1,12}$/.test(x.symbol), 'symbol');
    s.symbols.set(x.symbol, identifier(x.asset, 40));
  }
  let lastNumber = 0;
  for (const raw of list(v.inscriptions)) {
    const x = object(raw, ['number', 'id', 'creator', 'contentType', 'content', 'height', 'index']);
    const number = natural(x.number);
    requireThat(number > lastNumber, 'duplicate/unsorted inscription');
    lastNumber = number;
    const id = identifier(x.id, 40),
      creator = identifier(x.creator);
    const d = definitions.get(id);
    requireThat(
      d && d.contentType === x.contentType && d.content === x.content,
      'inscription/definition mismatch',
    );
    s.inscriptions.set(id, {
      id,
      number,
      creator,
      contentType: d.contentType,
      content: d.content,
      height: natural(x.height, height),
      index: natural(x.index, 0xffffffff),
    });
  }
  requireThat(definitions.size === s.inscriptions.size, 'inscription/definition mismatch');
  assertInvariants(s);
  requireThat(canonical(snapshot(s, genesis)) === canonical(input), 'noncanonical snapshot');
  return s;
}
export interface TrustKey {
  operator: string;
  keyId: string;
  publicKey: string;
  notBefore: number;
  notAfter: number;
  revoked: boolean;
}
export interface Policy {
  format: 1;
  version: number;
  genesis: string;
  activation: { height: number; hash: string };
  runtimeHash: string;
  rulesHash: string;
  requiredOperators: string[];
  keys: TrustKey[];
  validUntil: number;
}
export function policy(input: unknown, now = Date.now()): Policy {
  const p = object(input, [
    'format',
    'version',
    'genesis',
    'activation',
    'runtimeHash',
    'rulesHash',
    'requiredOperators',
    'keys',
    'validUntil',
  ]);
  requireThat(p.format === 1 && natural(p.version) > 0, 'policy version');
  requireThat(identifier(p.genesis) !== MAINNET, 'mainnet disabled');
  const a = object(p.activation, ['height', 'hash']);
  natural(a.height, 0xffffffff);
  identifier(a.hash);
  identifier(p.runtimeHash);
  identifier(p.rulesHash, 64);
  requireThat(natural(p.validUntil) > now, 'trust policy expired');
  const operators = list(p.requiredOperators);
  requireThat(
    operators.length >= 2 &&
      operators.length <= 5 &&
      new Set(operators).size === operators.length &&
      operators.every((x) => typeof x === 'string' && /^[a-z0-9-]{1,32}$/.test(x)),
    'two distinct operators required',
  );
  const publicKeys = new Set<string>();
  for (const k of list(p.keys)) {
    const x = object(k, ['operator', 'keyId', 'publicKey', 'notBefore', 'notAfter', 'revoked']);
    requireThat(operators.includes(x.operator) && typeof x.revoked === 'boolean', 'policy key');
    const pk = identifier(x.publicKey, 2592);
    requireThat(x.keyId === keyId(pk) && !publicKeys.has(pk), 'key substitution/duplicate');
    publicKeys.add(pk);
    requireThat(natural(x.notBefore) < natural(x.notAfter), 'key validity');
  }
  requireThat(list(p.keys).length <= 16, 'too many keys');
  for (const op of operators)
    requireThat(
      (p.keys as TrustKey[]).some(
        (k) => k.operator === op && !k.revoked && k.notBefore <= now && now < k.notAfter,
      ),
      'no live key for operator',
    );
  return structuredClone(p) as unknown as Policy;
}
export interface Statement {
  format: 1;
  protocol: typeof PROTOCOL;
  policyVersion: number;
  genesis: string;
  activation: { height: number; hash: string };
  runtimeHash: string;
  rulesHash: string;
  height: number;
  blockHash: string;
  parentHash: string;
  stateRoot: string;
  challenge: string;
  issuedAt: number;
  expiresAt: number;
  operator: string;
  keyId: string;
}
export interface Attestation {
  statement: Statement;
  signature: string;
}
export interface Bundle {
  snapshot: Snapshot;
  attestations: Attestation[];
}
export interface Cursor {
  policyVersion: number;
  height: number;
  blockHash: string;
  stateRoot: string;
}
export function cursorValue(input: unknown): Cursor {
  const c = object(input, ['policyVersion', 'height', 'blockHash', 'stateRoot']);
  requireThat(natural(c.policyVersion) > 0, 'cursor policy');
  return {
    policyVersion: Number(c.policyVersion),
    height: natural(c.height, 0xffffffff),
    blockHash: identifier(c.blockHash),
    stateRoot: identifier(c.stateRoot, 64),
  };
}
export const stateRoot = (v: unknown): string => hash512('Qlyphs/QPA1/state', v);
export const statementBytes = (s: Statement): Uint8Array =>
  enc.encode('Qlyphs/QPA1/statement\0' + canonical(s));
export function verifyBundle(
  input: unknown,
  trusted: Policy,
  challenge: string,
  before: Cursor | null,
  now = Date.now(),
): { state: State; cursor: Cursor } {
  const p = policy(trusted, now);
  identifier(challenge);
  const b = object(input, ['snapshot', 'attestations']);
  requireThat(enc.encode(canonical(b)).length <= MAX_PROOF_BYTES, 'proof too large');
  const snap = snapshotState(b.snapshot, p.genesis),
    root = stateRoot(b.snapshot);
  requireThat(snap.height >= p.activation.height, 'before activation');
  const attestations = list(b.attestations);
  requireThat(attestations.length === p.requiredOperators.length, 'witness count');
  const seen = new Set<string>();
  let parent: string | null = null;
  for (const raw of attestations) {
    const a = object(raw, ['statement', 'signature']);
    const s = object(a.statement, [
      'format',
      'protocol',
      'policyVersion',
      'genesis',
      'activation',
      'runtimeHash',
      'rulesHash',
      'height',
      'blockHash',
      'parentHash',
      'stateRoot',
      'challenge',
      'issuedAt',
      'expiresAt',
      'operator',
      'keyId',
    ]) as unknown as Statement;
    requireThat(
      s.format === 1 &&
        s.protocol === PROTOCOL &&
        s.policyVersion === p.version &&
        s.genesis === p.genesis &&
        canonical(s.activation) === canonical(p.activation) &&
        s.runtimeHash === p.runtimeHash &&
        s.rulesHash === p.rulesHash,
      'foreign policy/network/runtime/rules',
    );
    requireThat(
      s.height === snap.height &&
        s.blockHash === snap.hash &&
        s.stateRoot === root &&
        s.challenge === challenge,
      'divergent state/challenge',
    );
    identifier(s.parentHash);
    requireThat(parent === null || parent === s.parentHash, 'divergent parent');
    parent = s.parentHash;
    const issued = natural(s.issuedAt),
      expires = natural(s.expiresAt);
    requireThat(
      issued <= now &&
        expires > now &&
        expires > issued &&
        expires - issued <= MAX_TTL_MS &&
        now - issued <= MAX_TTL_MS,
      'stale/future attestation',
    );
    requireThat(
      p.requiredOperators.includes(s.operator) && !seen.has(s.operator),
      'duplicate/untrusted witness',
    );
    seen.add(s.operator);
    const k = p.keys.find((k) => k.keyId === s.keyId && k.operator === s.operator);
    requireThat(
      k && !k.revoked && k.notBefore <= issued && now < k.notAfter && expires <= k.notAfter,
      'unknown/revoked/expired key',
    );
    const sig = fromHex(String(a.signature), 4627);
    requireThat(
      ml_dsa87.verify(sig, statementBytes(s), fromHex(k.publicKey, 2592)),
      'invalid ML-DSA signature',
    );
  }
  const cursor = {
    policyVersion: p.version,
    height: snap.height,
    blockHash: snap.hash,
    stateRoot: root,
  };
  if (before) {
    before = cursorValue(before);
    requireThat(
      p.version >= before.policyVersion && cursor.height >= before.height,
      'checkpoint/policy rollback',
    );
    if (cursor.height === before.height)
      requireThat(
        cursor.blockHash === before.blockHash && cursor.stateRoot === before.stateRoot,
        'checkpoint equivocation',
      );
  }
  return { state: snap, cursor };
}
export function verifiedPurchase(callHex: string, owner: string, s: State): void {
  const call = parseCall(fromHex(callHex));
  requireThat(call.kind === 'batch' && call.calls[0]?.kind === 'approve', 'not canonical purchase');
  const first = call.calls[0],
    t = s.tickets.get(`${first.multisig}:${first.proposal}`);
  requireThat(
    t &&
      t.status === 'locked' &&
      t.offer.buyer === owner &&
      t.createdHeight <= s.finalized &&
      s.height <= t.offer.expiry,
    'not a finalized live reservation for buyer',
  );
  requireThat(hex(callBytes(buyCall(t))) === callHex, 'purchase differs from attested reservation');
}
