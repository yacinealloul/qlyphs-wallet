/**
 * Adapter interfaces (SPEC §4). Implementations live in `@qotc/chain` and `@qotc/evm`;
 * the API and the apps only depend on these types.
 */

/** SCALE-encoded call: `hex` is 0x-prefixed call bytes, `hash` the 0x-prefixed call hash. */
export interface EncodedCall {
  hex: string;
  hash: string;
}

export type ChainMode = 'mock' | 'quantus';
export type EvmMode = 'mock' | 'viem';

export type ProposalStatus = 'active' | 'approved' | 'executed' | 'cancelled' | 'expired';

export interface EscrowProposal {
  id: number;
  proposer: string;
  callHex: string;
  approvals: string[];
  status: ProposalStatus;
  /** Block number at which the proposal expires. */
  expiry: number;
}

export interface EscrowState {
  exists: boolean;
  signers: string[];
  threshold: number;
  /** Free balance of the multisig account, planck. */
  free: bigint;
  proposals: EscrowProposal[];
  observedAtBlock: number;
}

export interface ReleaseCallParams {
  buyer: string;
  /** Full trade amount in planck; the buyer receives `amount - fee`. */
  amount: bigint;
  fee: bigint;
  feeAccount: string;
}

export interface EscrowReadOptions {
  /** Read this many blocks below the best block. Default 0. */
  confirmations?: number;
}

export interface ApproveAndExecuteParams {
  multisig: string;
  proposalId: number;
  callHex: string;
  /**
   * Last look before the irreversible step: awaited after the approval is included and right
   * before `execute` is submitted. Resolving `false` stops there. That is safe, an approved
   * proposal moves nothing until someone executes it.
   */
  beforeExecute?: () => Promise<boolean>;
}

export interface ApproveAndExecuteResult {
  txHashes: string[];
  /** False when `beforeExecute` stopped the operation; the proposal is then still in storage. */
  executed: boolean;
}

export interface ChainAdapter {
  head(): Promise<{ number: number; hash: string }>;
  isValidAddress(a: string): boolean;
  multisigAddress(signers: string[], threshold: number, nonce: bigint): string;
  buildReleaseCall(p: ReleaseCallParams): EncodedCall;
  buildRefundCall(p: { to: string }): EncodedCall;
  /**
   * State at the best block, or `confirmations` blocks below it. On a PoW chain, what is visible N
   * blocks below the head has N confirmations; `observedAtBlock` is the block actually read.
   */
  getEscrowState(multisig: string, opts?: EscrowReadOptions): Promise<EscrowState>;
  /**
   * Signed by the PlatformSigner. `callHex` must equal the proposal's call byte for byte.
   * Returns once the extrinsics are included in the best chain, which is not final: callers wait
   * for the effect to show `confirmations` deep before treating it as done.
   */
  approveAndExecute(p: ApproveAndExecuteParams): Promise<ApproveAndExecuteResult>;
  platformAddress(): string;
  explorerUrl(kind: 'tx' | 'account' | 'block', id: string): string;
}

/* ------------------------------------------------------------------ custody (SPEC §3b) */

export interface CustodyLeg {
  to: string;
  /** Planck. */
  amount: bigint;
}

export interface CustodyTransferResult {
  txHash: string;
  /** Block the extrinsic was included in (best chain, not final). */
  block: number;
  /** Fee actually charged to the custody account, planck. */
  fee: bigint;
}

/** A freshly generated custodial wallet. `secret` is a 24-word mnemonic: encrypt it before it touches storage. */
export interface CustodyWallet {
  address: string;
  secret: string;
}

/**
 * Custodial QTC wallets (SPEC §3b): one independent 24-word wallet per user, at the official wallet's
 * default path `m/44'/189189'/0'/0'/0'`, so an exported phrase imports into the Quantus wallet as is.
 * The adapter is stateless about keys: the API keeps each secret encrypted at rest (AES-256-GCM under
 * `CUSTODY_MASTER_KEY`) and hands it over only for the duration of one call. Never log a secret.
 */
export interface CustodyAdapter {
  createWallet(): Promise<CustodyWallet>;
  /** Address of a secret; throws `INVALID_ARGUMENT` on a malformed phrase. */
  addressOf(secret: string): Promise<string>;
  /** Free (spendable) balance, optionally as seen `confirmations` blocks below the head. */
  freeBalance(address: string, opts?: { confirmations?: number }): Promise<bigint>;
  /** Existential deposit: an account must keep at least this much or be reaped. */
  existentialDeposit(): Promise<bigint>;
  /** Upper bound of the fee for a transfer with `legs` legs, planck. */
  estimateTransferFee(legs: number): Promise<bigint>;
  /**
   * Signed with `secret`. One leg is a `transfer_keep_alive`; several legs are one atomic
   * `utility.batch_all`. Resolves once included; callers wait for confirmations themselves.
   * Extrinsics of one account are serialised (nonce order).
   */
  custodyTransfer(p: {
    secret: string;
    legs: readonly CustodyLeg[];
  }): Promise<CustodyTransferResult>;
  /**
   * Was the extrinsic with this hash included and successful, where, and which balance transfers
   * did it make? Restart safety for transfers signed here, and the proof for ones signed elsewhere.
   */
  findTransfer(txHash: string, fromBlock: number): Promise<FoundTransfer | null>;
}

/** One `Balances.Transfer` an extrinsic made. */
export interface BalanceTransfer {
  from: string;
  to: string;
  /** Planck. */
  amount: bigint;
}

export interface FoundTransfer {
  block: number;
  transfers: BalanceTransfer[];
}

export interface UsdcTransfer {
  txHash: string;
  /**
   * Position of the `Transfer` log in its block. One transaction can carry several transfers
   * (multisend, smart-wallet batch), so a transfer is identified by `(txHash, logIndex)`.
   */
  logIndex: number;
  from: string;
  to: string;
  /** USDC micro. */
  value: bigint;
  block: number;
  confirmations: number;
}

export interface EvmAdapter {
  head(): Promise<number>;
  isValidAddress(a: string): boolean;
  findUsdcTransfers(p: {
    from?: string;
    to: string;
    fromBlock: number;
    tokenAddress?: string;
  }): Promise<UsdcTransfer[]>;
  explorerUrl(kind: 'tx' | 'address', id: string): string;
}

/**
 * Platform co-signer key `P`. Dev: mnemonic from env. Production: HSM / remote signer behind the
 * same interface. `P` alone can never move escrowed funds (2-of-2 with the seller escrow key).
 */
export interface PlatformSigner {
  /** SS58 (prefix 189) address of `P`. */
  address(): string;
  /** 0x-prefixed public key of `P`. */
  publicKey(): string;
  /** Sign an extrinsic signing payload; returns the raw signature bytes. */
  sign(payload: Uint8Array): Promise<Uint8Array>;
}

/* ------------------------------------------------------------------ browser escrow helpers */

export interface EscrowKey {
  /** SS58 (prefix 189) address of the per-trade seller escrow key `S_t`. */
  address: string;
  /** 0x-prefixed public key. */
  publicKey: string;
}

export interface BrowserChainContext {
  /** Websocket RPC endpoint (quantus mode) or the API base used by the mock helper. */
  endpoint: string;
}

export interface LockParams {
  mnemonic: string;
  /** HD index of `S_t` for this trade. */
  index: number;
  platformAddress: string;
  multisigNonce: bigint;
  /** Address the API computed at match; the helper refuses to proceed if its own derivation differs. */
  expectedMultisigAddress: string;
  /** planck moved into the multisig. */
  amount: bigint;
  /** Canonical release call `R` from the API. */
  releaseCall: EncodedCall;
  /**
   * What `R` has to pay, as the trade room shows it. The helper rebuilds the call from these and
   * refuses to sign any other bytes (nothing is sent). `feeAccount` comes from `PublicConfig`.
   */
  buyer: string;
  fee: bigint;
  feeAccount: string;
  onProgress?: (step: LockStep) => void;
  /** Called with the hash of every extrinsic as soon as it is in a block, also when a later step fails. */
  onTx?: (txHash: string) => void;
}

export type LockStep =
  'checking_balance' | 'creating_multisig' | 'funding_multisig' | 'proposing_release' | 'done';

export interface LockResult {
  multisigAddress: string;
  txHashes: string[];
  /** Proposal id when the helper could read it back; the API always re-derives it on-chain. */
  proposalId: number | null;
}

export interface RefundParams {
  mnemonic: string;
  index: number;
  multisigAddress: string;
  /** Release proposal to cancel first. `null` if it is already gone. */
  releaseProposalId: number | null;
  /** Canonical refund call from the API: `transfer_all(sellerPayoutAddress)`. */
  refundCall: EncodedCall;
  /**
   * The seller's payout address. The helper refuses, before cancelling anything, a refund call
   * that is not exactly `transfer_all(to, keep_alive = false)`.
   */
  to: string;
  onProgress?: (step: RefundStep) => void;
  /** Called with the hash of every extrinsic as soon as it is in a block, also when a later step fails. */
  onTx?: (txHash: string) => void;
}

export type RefundStep = 'cancelling_release' | 'proposing_refund' | 'done';

export interface RefundResult {
  txHashes: string[];
  proposalId: number | null;
}

export interface SweepParams {
  mnemonic: string;
  index: number;
  /** Seller payout address receiving the leftover dust of `S_t`. */
  to: string;
}

/** Surface of `@qotc/chain/browser`; the mock build exposes the same API. */
export interface BrowserEscrow {
  generateMnemonic(): Promise<string>;
  validateMnemonic(mnemonic: string): boolean;
  deriveEscrowKey(mnemonic: string, index: number): Promise<EscrowKey>;
  /** Free balance of any address, planck (deposit wizard polls the `S_t` address). */
  freeBalance(ctx: BrowserChainContext, address: string): Promise<bigint>;
  signAndSubmitLock(ctx: BrowserChainContext, p: LockParams): Promise<LockResult>;
  signAndSubmitRefund(ctx: BrowserChainContext, p: RefundParams): Promise<RefundResult>;
  /** Returns the tx hash, or `null` when there was nothing worth sweeping. */
  sweep(ctx: BrowserChainContext, p: SweepParams): Promise<{ txHash: string | null }>;
}

/* ------------------------------------------------------------------ escrow verification */

export type EscrowCheckFailure =
  | 'MULTISIG_MISSING'
  | 'SIGNERS_MISMATCH'
  | 'THRESHOLD_MISMATCH'
  | 'INSUFFICIENT_BALANCE'
  | 'PROPOSAL_MISSING'
  | 'PROPOSAL_NOT_ACTIVE'
  | 'PROPOSAL_EXPIRES_TOO_SOON';

export type EscrowCheck =
  { ok: true; proposalId: number } | { ok: false; failure: EscrowCheckFailure; message: string };

const normalizeHex = (hex: string): string => hex.toLowerCase().replace(/^0x/, '');

/**
 * Pure check used before AWAITING_PAYMENT and again before release/refund: the multisig exists with
 * exactly the expected signers and threshold, holds at least `minFree`, and carries a live proposal by
 * `proposer` whose call bytes equal `callHex`. Pass `minFree = 0n` when only the proposal matters.
 *
 * `minExpiry` (absolute block) is for the moments the buyer is invited to pay: the proposal must
 * outlive the payment window, or the seller could let `R` lapse right after being paid. Leave it
 * out before co-signing, where only "not expired now" may matter.
 */
export function verifyEscrow(
  state: EscrowState,
  expected: {
    signers: readonly string[];
    threshold: number;
    minFree: bigint;
    callHex: string;
    proposer: string;
    minExpiry?: number;
  },
): EscrowCheck {
  if (!state.exists) {
    return {
      ok: false,
      failure: 'MULTISIG_MISSING',
      message: 'Escrow multisig does not exist on-chain',
    };
  }
  const actual = [...state.signers].sort();
  const wanted = [...expected.signers].sort();
  if (actual.length !== wanted.length || actual.some((s, i) => s !== wanted[i])) {
    return {
      ok: false,
      failure: 'SIGNERS_MISMATCH',
      message: 'Escrow multisig signers do not match',
    };
  }
  if (state.threshold !== expected.threshold) {
    return {
      ok: false,
      failure: 'THRESHOLD_MISMATCH',
      message: 'Escrow multisig threshold does not match',
    };
  }
  if (state.free < expected.minFree) {
    return {
      ok: false,
      failure: 'INSUFFICIENT_BALANCE',
      message: 'Escrow multisig balance is below the trade amount',
    };
  }
  const target = normalizeHex(expected.callHex);
  const matching = state.proposals.filter(
    (p) => normalizeHex(p.callHex) === target && p.proposer === expected.proposer,
  );
  if (matching.length === 0) {
    return {
      ok: false,
      failure: 'PROPOSAL_MISSING',
      message: 'No proposal with the expected call bytes',
    };
  }
  const live = matching.find((p) => p.status === 'active' || p.status === 'approved');
  if (!live || live.expiry <= state.observedAtBlock) {
    return {
      ok: false,
      failure: 'PROPOSAL_NOT_ACTIVE',
      message: 'The matching proposal is no longer active',
    };
  }
  if (expected.minExpiry !== undefined && live.expiry < expected.minExpiry) {
    return {
      ok: false,
      failure: 'PROPOSAL_EXPIRES_TOO_SOON',
      message: `The matching proposal expires at block ${live.expiry}, before block ${expected.minExpiry}: propose it again with the longest expiry`,
    };
  }
  return { ok: true, proposalId: live.id };
}
