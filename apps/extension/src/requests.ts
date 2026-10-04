/** The public API accepts intentions, never bytes, origins, RPCs or passwords. */
import { parseCommand, json } from '../../native/src/commands.ts';
import { fromHex, requireThat } from '../../../packages/native/src/codec.ts';
import { parseMintSessionTerms } from '../../../packages/provider/src/mint-session.ts';
import type { MintSessionParams } from '../../../packages/provider/src/mint-session.ts';
export const VERSION = 1;
export const MAX_PENDING = 8;
export interface TransactionParams {
  owner: string;
  genesis: string;
  command: Record<string, unknown>;
}
export type Request = { id: string } & (
  | {
      method:
        | 'connect'
        | 'accounts'
        | 'network'
        | 'disconnect'
        | 'capabilities'
        | 'state'
        | 'mintSession';
    }
  | { method: 'cancelRequest'; target: string }
  | { method: 'requestTransaction'; params: TransactionParams }
  | { method: 'requestMintSession'; params: MintSessionParams }
  | { method: 'stopMintSession'; params: { session: string } }
);
const METHODS = [
  'connect',
  'accounts',
  'network',
  'disconnect',
  'requestTransaction',
  'capabilities',
  'state',
  'cancelRequest',
  'requestMintSession',
  'mintSession',
  'stopMintSession',
];
const WITH_PARAMS = ['requestTransaction', 'requestMintSession', 'stopMintSession'];
/** A mint session id: the UUID the wallet generated for its review. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function exact(value: unknown, names: string[]): asserts value is Record<string, unknown> {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'Object required');
  const o = value as Record<string, unknown>;
  requireThat(
    Object.keys(o).length === names.length && names.every((k) => Object.hasOwn(o, k)),
    'Unexpected fields',
  );
}
export function parseRequest(input: unknown): Request {
  requireThat(
    typeof input === 'object' && input !== null && JSON.stringify(input).length <= 8192,
    'Invalid request size',
  );
  const r = input as { id?: unknown; method?: unknown; params?: unknown; target?: unknown };
  exact(
    r,
    WITH_PARAMS.includes(r.method as string)
      ? ['id', 'method', 'params']
      : r.method === 'cancelRequest'
        ? ['id', 'method', 'target']
        : ['id', 'method'],
  );
  requireThat(
    typeof r.id === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(r.id),
    'Invalid request identifier',
  );
  requireThat(METHODS.includes(r.method as string), 'Unsupported method');
  if (r.method === 'cancelRequest')
    requireThat(
      typeof r.target === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(r.target),
      'Invalid cancellation identifier',
    );
  if (r.method === 'requestTransaction') {
    exact(r.params, ['owner', 'genesis', 'command']);
    fromHex(r.params.owner as string, 32);
    fromHex(r.params.genesis as string, 32);
    // Canonicalize with the single shared command parser, rejecting extra fields.
    r.params = {
      ...r.params,
      command: JSON.parse(json(parseCommand(r.params.command))) as Record<string, unknown>,
    };
  }
  if (r.method === 'requestMintSession') {
    exact(r.params, ['owner', 'genesis', 'terms']);
    fromHex(r.params.owner as string, 32);
    fromHex(r.params.genesis as string, 32);
    // The one rule set the SDK and the wallet share; it returns the terms in canonical order.
    r.params = {
      owner: r.params.owner,
      genesis: r.params.genesis,
      terms: parseMintSessionTerms(r.params.terms),
    };
  }
  if (r.method === 'stopMintSession') {
    exact(r.params, ['session']);
    requireThat(
      typeof r.params.session === 'string' && SESSION_ID.test(r.params.session),
      'Invalid session identifier',
    );
  }
  return structuredClone(r) as Request;
}
export interface BoundDocument {
  origin: string;
  tabId: number;
  document: string;
}
export interface Pending<T> {
  id: string;
  document: BoundDocument;
  expires: number;
  value: T;
  phase: 'review' | 'consumed';
}
export class Requests<T> {
  private items = new Map<string, Pending<T>>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }
  add(document: BoundDocument, value: T): Pending<T> {
    this.sweep();
    requireThat(this.items.size < MAX_PENDING, 'Too many pending requests');
    const p: Pending<T> = {
      id: crypto.randomUUID(),
      document: { ...document },
      expires: this.now() + 120000,
      value,
      phase: 'review',
    };
    this.items.set(p.id, p);
    return p;
  }
  get(id: string): Pending<T> {
    this.sweep();
    const p = this.items.get(id);
    requireThat(p && p.phase === 'review', 'Request expired or cancelled');
    return p!;
  }
  consume(id: string): Pending<T> {
    const p = this.get(id);
    p.phase = 'consumed';
    this.items.delete(id);
    return p;
  }
  remove(id: string): void {
    this.items.delete(id);
  }
  invalidate(test: (document: BoundDocument) => boolean): void {
    for (const [id, p] of this.items) if (test(p.document)) this.items.delete(id);
  }
  sweep(): void {
    for (const [id, p] of this.items) if (p.expires <= this.now()) this.items.delete(id);
  }
}
export function sameExtensionPage(url: string | undefined, root: string, path: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url),
      r = new URL(root);
    return u.protocol === r.protocol && u.host === r.host && u.pathname === path;
  } catch {
    return false;
  }
}
export function pageOrigin(
  url: string | undefined,
  frameId: number | undefined,
  allowed: string | readonly string[],
): string {
  requireThat(url && frameId === 0, 'Only top-level documents may connect');
  const u = new URL(url!);
  requireThat(
    (typeof allowed === 'string' ? u.origin === allowed : allowed.includes(u.origin)) &&
      ['http:', 'https:'].includes(u.protocol),
    'Site is not permitted',
  );
  return u.origin;
}
