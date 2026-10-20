/** Solana vault authorizations in the wallet: checks one against the active account, then signs it. */
import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import type { QuantusWasmAccountHandle } from '../../../packages/chain/src/browser/quantus-wasm.web.js';
import { hex, requireThat } from '../../../packages/native/src/codec.ts';
import { formatUnits } from '../../../packages/native/src/commands.ts';
import { quantusAddress } from '../../../packages/chain/src/codec/ss58.ts';
import {
  base58,
  checkSolanaVaultWindow,
  parseSolanaVaultAuthorization,
  solanaCurrentSlot,
  solanaVaultAddress,
  solanaVaultBytes,
  SOLANA_VAULT_CONTEXT,
  SOLANA_VAULT_DEPLOYMENTS,
  SOLANA_VAULT_MESSAGE_BYTES,
  SOLANA_VAULT_REDEEM_DECIMALS,
} from '../../../packages/provider/src/solana-vault.ts';
import type {
  SolanaVaultAuthorization,
  SolanaVaultDeployment,
  SolanaVaultSignature,
} from '../../../packages/provider/src/solana-vault.ts';
import {
  SOLANA_VAULT_FORMAT_ERROR,
  SOLANA_VAULT_KEY_ERROR,
  SOLANA_VAULT_SLOT_ERROR,
  SOLANA_VAULT_WINDOW_ERROR,
} from './solana-vault-copy.ts';

/** The wQTC deployment of a development build (build.mjs), 0x hex; absent from every other build. */
declare const QLYPHS_SOLANA_WQTC: { program: string; mint: string } | null | undefined;
const WQTC = typeof QLYPHS_SOLANA_WQTC === 'object' ? QLYPHS_SOLANA_WQTC : null;

/**
 * What this wallet signs for: the vault program, and in a development build given a wQTC program
 * and mint, the wQTC program on the same cluster. Its vaults use the same seeds under its own id.
 */
export const WALLET_DEPLOYMENTS: readonly SolanaVaultDeployment[] = Object.freeze([
  ...SOLANA_VAULT_DEPLOYMENTS,
  ...(WQTC
    ? [
        Object.freeze({
          name: SOLANA_VAULT_DEPLOYMENTS[0]!.name,
          genesis: SOLANA_VAULT_DEPLOYMENTS[0]!.genesis,
          program: canonical(WQTC.program),
          redeemMint: canonical(WQTC.mint),
        }),
      ]
    : []),
]);
function canonical(value: string): string {
  const bytes = solanaVaultBytes(value, 32);
  requireThat(bytes.some((x) => x !== 0), 'Invalid wQTC deployment');
  return value;
}

/** What the review window shows, all as text: addresses in base58, amounts with their decimals. */
export interface SolanaVaultReview {
  readonly network: string;
  readonly program: string;
  readonly vault: string;
  /** `redeem` burns wQTC from the vault for QTC on Quantus; `payment` moves SOL or a token. */
  readonly kind: 'payment' | 'redeem';
  readonly asset: 'SOL' | 'SPL';
  /** What the amount counts: `SOL`, `wQTC` (the build's wQTC mint) or `tokens`. */
  readonly unit: 'SOL' | 'wQTC' | 'tokens';
  /** SPL only: the token mint and the vault's source token account. */
  readonly mint: string | null;
  readonly source: string | null;
  readonly decimals: number;
  /** Base units, exact. */
  readonly amount: string;
  /** `amount` with the asset's decimals, e.g. `1.5 SOL`. */
  readonly amountText: string;
  /** A Solana address (base58), or for a redeem the Quantus address (`qz…`) that receives QTC. */
  readonly destination: string;
  /** Redeem only: the destination is the signing account itself. */
  readonly ownAccount: boolean;
  /** One line for the person: `Redeem 1.5 wQTC → QTC to qz… (your account)`, `Pay 1.5 SOL to …`. */
  readonly summary: string;
  readonly nonce: string;
  readonly expirySlot: string;
  readonly issuedSlot: string;
  /** The cluster's slot when the wallet checked the window, read by the wallet, never the site. */
  readonly currentSlot: string;
}

/** Lamports per SOL: the message carries decimals for tokens only. */
const SOL_DECIMALS = 9;
const address = (value: string) => base58(solanaVaultBytes(value, 32));

function unitOf(a: SolanaVaultAuthorization): SolanaVaultReview['unit'] {
  if (a.asset === 'SOL') return 'SOL';
  // A token counts as wQTC only by its mint and decimals, whichever program moves it.
  const wqtc = WALLET_DEPLOYMENTS.some((d) => d.redeemMint === a.mint);
  return wqtc && a.decimals === SOLANA_VAULT_REDEEM_DECIMALS ? 'wQTC' : 'tokens';
}

/**
 * The authorization, once it passes every format and allowlist check, names the vault of
 * `publicKey` (the active account's key) and is valid from the cluster's current slot, which
 * `slotOf` reads from the wallet's own endpoint (never the site): a post-dated or expired one is
 * refused. `owner` is that account's id (0x hex): a redeem to it says so. Refusals are fixed texts.
 */
export async function reviewSolanaVault(
  message: string,
  publicKey: Uint8Array,
  owner: string,
  slotOf: (deployment: SolanaVaultDeployment) => Promise<bigint> = solanaCurrentSlot,
): Promise<SolanaVaultReview> {
  let a: SolanaVaultAuthorization;
  try {
    a = parseSolanaVaultAuthorization(message, WALLET_DEPLOYMENTS);
  } catch {
    throw Error(SOLANA_VAULT_FORMAT_ERROR);
  }
  requireThat((await solanaVaultAddress(publicKey, a.deployment)) === a.vault, SOLANA_VAULT_KEY_ERROR);
  let currentSlot: bigint;
  try {
    currentSlot = await slotOf(a.deployment);
  } catch {
    throw Error(SOLANA_VAULT_SLOT_ERROR);
  }
  try {
    checkSolanaVaultWindow(a, currentSlot);
  } catch {
    throw Error(SOLANA_VAULT_WINDOW_ERROR);
  }
  const decimals = a.asset === 'SOL' ? SOL_DECIMALS : a.decimals;
  const unit = unitOf(a);
  const amountText = `${formatUnits(a.amount, decimals)} ${unit}`;
  const redeem = a.kind === 'redeem';
  const ownAccount = redeem && a.destination === owner;
  const destination = redeem
    ? quantusAddress(solanaVaultBytes(a.destination, 32))
    : address(a.destination);
  return Object.freeze({
    network: a.deployment.name,
    program: address(a.deployment.program),
    vault: address(a.vault),
    kind: a.kind,
    asset: a.asset,
    unit,
    mint: a.mint && address(a.mint),
    source: a.source && address(a.source),
    decimals,
    amount: a.amount.toString(),
    amountText,
    destination,
    ownAccount,
    summary: redeem
      ? `Redeem ${amountText} → QTC to ${destination}${ownAccount ? ' (your account)' : ''}`
      : `Pay ${amountText} to ${destination}`,
    nonce: a.nonce.toString(),
    expirySlot: a.expiry.toString(),
    issuedSlot: a.issuedAt.toString(),
    currentSlot: currentSlot.toString(),
  });
}

/**
 * The account's public key, read from a handle that is then freed. Its secret key is never read:
 * the binding's getter copies it out of the module (a heap buffer freed unwiped, then a JS copy),
 * so reading it only to wipe it would leave more copies, not fewer.
 */
export function publicKeyOf(account: QuantusWasmAccountHandle, owner: string): Uint8Array {
  try {
    requireThat(hex(account.accountId) === owner, 'Signing key does not match the account');
    return account.publicKey.slice();
  } finally {
    account.free();
  }
}

const CONTEXT = new TextEncoder().encode(SOLANA_VAULT_CONTEXT);

/**
 * Signs the authorization with the account's ML-DSA-87 key under the vault context and checks the
 * signature locally. `account` is taken over: the copy of its secret key is wiped and the handle
 * freed before return. `publicKey` is the key the review checked the vault against.
 */
export function signSolanaVault(
  account: QuantusWasmAccountHandle,
  owner: string,
  publicKey: Uint8Array,
  message: string,
): SolanaVaultSignature {
  let secretKey: Uint8Array | undefined;
  try {
    requireThat(hex(account.accountId) === owner, 'Signing key does not match the account');
    const key = account.publicKey;
    requireThat(hex(key) === hex(publicKey), SOLANA_VAULT_KEY_ERROR);
    const bytes = solanaVaultBytes(message, SOLANA_VAULT_MESSAGE_BYTES);
    secretKey = account.secretKey;
    const signature = ml_dsa87.sign(bytes, secretKey, { context: CONTEXT });
    // A faulty signature is caught here rather than by the vault program.
    requireThat(
      ml_dsa87.verify(signature, bytes, key, { context: CONTEXT }),
      'Local signature failed',
    );
    return { publicKey: hex(key), signature: hex(signature) };
  } finally {
    secretKey?.fill(0);
    account.free();
  }
}
