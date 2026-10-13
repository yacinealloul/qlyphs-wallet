/** Site sign-in: checks a session challenge against the wallet's own context, then signs it. */
import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import type { QuantusWasmAccountHandle } from '../../../packages/chain/src/browser/quantus-wasm.web.js';
import { hex, requireThat } from '../../../packages/native/src/codec.ts';
import {
  encodeSiteSessionChallenge,
  MAX_SITE_SESSION_MS,
  parseSiteSessionChallenge,
  SITE_SESSION_CONTEXT,
} from '../../../packages/provider/src/site-session.ts';
import type {
  SiteSessionChallenge,
  SiteSessionProof,
} from '../../../packages/provider/src/site-session.ts';
import {
  SIGN_IN_ACCOUNT_ERROR,
  SIGN_IN_EXPIRED_ERROR,
  SIGN_IN_FORMAT_ERROR,
  SIGN_IN_NETWORK_ERROR,
  SIGN_IN_SITE_ERROR,
  SIGN_IN_TOO_LONG_ERROR,
} from './sign-in-copy.ts';

/** What the wallet itself knows about the request: never values the page supplied. */
export interface SignInContext {
  /** The origin of the connected document that asked, as the browser reported it. */
  readonly origin: string;
  readonly owner: string;
  readonly genesis: string;
  readonly now: number;
}

/**
 * The challenge, once it names exactly this site, account and network, and a session that is
 * still open and ends at most 15 minutes from now on this device's clock. Refusals are fixed texts.
 */
export function reviewSignIn(challenge: string, context: SignInContext): SiteSessionChallenge {
  let c: SiteSessionChallenge;
  try {
    c = parseSiteSessionChallenge(challenge);
  } catch {
    throw Error(SIGN_IN_FORMAT_ERROR);
  }
  requireThat(c.origin === context.origin, SIGN_IN_SITE_ERROR);
  requireThat(c.genesis === context.genesis, SIGN_IN_NETWORK_ERROR);
  requireThat(c.account === context.owner, SIGN_IN_ACCOUNT_ERROR);
  requireThat(c.expiresAt > context.now, SIGN_IN_EXPIRED_ERROR);
  requireThat(c.expiresAt - context.now <= MAX_SITE_SESSION_MS, SIGN_IN_TOO_LONG_ERROR);
  return c;
}

const CONTEXT = new TextEncoder().encode(SITE_SESSION_CONTEXT);

/**
 * Signs the challenge with the account's ML-DSA-87 key, under the site session context. `account`
 * is the handle the wallet derives to sign transactions; this takes it over: the copy of its secret
 * key is wiped and the handle freed before return.
 */
export function signSignIn(
  account: QuantusWasmAccountHandle,
  owner: string,
  challenge: SiteSessionChallenge,
): SiteSessionProof {
  let secretKey: Uint8Array | undefined;
  try {
    requireThat(hex(account.accountId) === owner, 'Signing key does not match the account');
    const publicKey = account.publicKey;
    secretKey = account.secretKey;
    const message = encodeSiteSessionChallenge(challenge);
    const signature = ml_dsa87.sign(message, secretKey, { context: CONTEXT });
    // A faulty signature is caught here rather than by the site.
    requireThat(
      ml_dsa87.verify(signature, message, publicKey, { context: CONTEXT }),
      'Local signature failed',
    );
    return { signature: hex(signature), publicKey: hex(publicKey) };
  } finally {
    secretKey?.fill(0);
    account.free();
  }
}
