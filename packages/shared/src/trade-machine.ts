/**
 * Trade state machine (SPEC §3b, custodial escrow). Pure: no clock, no I/O. The API applies
 * `transition` inside a DB transaction with a row lock and writes one `trade_events` audit row per
 * accepted event.
 *
 *   AWAITING_LOCK --LOCK_VERIFIED--> AWAITING_PAYMENT --PAYMENT_CONFIRMED--> RELEASING --RELEASE_EXECUTED--> COMPLETED
 *   AWAITING_LOCK --LOCK_FAILED--> CANCELLED     (seller wallet cannot fund the escrow: offer restored, seller warned)
 *   AWAITING_LOCK --LOCK_TIMEOUT--> CANCELLED    (the platform could not move the QTC in time: nobody is warned)
 *   AWAITING_PAYMENT --PAY_TIMEOUT--> REFUNDING --REFUND_EXECUTED--> REFUNDED
 *   AWAITING_PAYMENT | RELEASING | REFUNDING --DISPUTE_OPENED--> DISPUTED --DISPUTE_RESOLVED--> RELEASING | REFUNDING
 *   REFUNDING --PAYMENT_CONFIRMED--> DISPUTED   (never refund a paid trade automatically)
 *   DISPUTED --PAYMENT_CONFIRMED--> DISPUTED    (recorded for the admin)
 *   AWAITING_PAYMENT | RELEASING | REFUNDING --ESCROW_INVALIDATED--> DISPUTED   (escrow accounting or a custody transfer needs a human)
 *
 * Brokered trades (`kind: 'broker'`, the platform's market maker selling QTC it buys on SafeTrade
 * just in time) are born AWAITING_PAYMENT, with nothing locked:
 *
 *   AWAITING_PAYMENT --PAYMENT_CONFIRMED--> AWAITING_DELIVERY --DELIVERY_LOCKED--> RELEASING --> COMPLETED
 *   AWAITING_PAYMENT --PAY_TIMEOUT--> CANCELLED              (nothing was locked, nothing to refund)
 *   AWAITING_DELIVERY --DELIVERY_TIMEOUT--> DISPUTED        (paid, not delivered in time: a human decides)
 *   DISPUTED (escrow empty) --DISPUTE_RESOLVED--> AWAITING_DELIVERY (deliver) | REFUNDED (USDC returned by hand)
 *
 * The lock is automatic: the worker moves `amount` from the seller's custodial wallet into the
 * platform escrow wallet. The browser-escrow states and events of the first design keep their
 * names, so rows written before §3b still parse.
 */

export const TRADE_STATES = [
  'AWAITING_LOCK',
  'AWAITING_PAYMENT',
  'AWAITING_DELIVERY',
  'RELEASING',
  'COMPLETED',
  'CANCELLED',
  'REFUNDING',
  'REFUNDED',
  'DISPUTED',
] as const;
export type TradeState = (typeof TRADE_STATES)[number];

export const TERMINAL_TRADE_STATES = ['COMPLETED', 'CANCELLED', 'REFUNDED'] as const;
export type TerminalTradeState = (typeof TERMINAL_TRADE_STATES)[number];

export const TRADE_EVENT_TYPES = [
  'LOCK_VERIFIED',
  'LOCK_FAILED',
  'LOCK_TIMEOUT',
  'PAYMENT_CONFIRMED',
  'PAY_TIMEOUT',
  'RELEASE_EXECUTED',
  'REFUND_EXECUTED',
  'DISPUTE_OPENED',
  'DISPUTE_RESOLVED',
  'ESCROW_INVALIDATED',
  'DELIVERY_LOCKED',
  'DELIVERY_TIMEOUT',
] as const;
export type TradeEventType = (typeof TRADE_EVENT_TYPES)[number];

export type DisputeResolution = 'release' | 'refund';
export type DisputeOpener = 'seller' | 'buyer' | 'admin' | 'system';

export type TradeEvent =
  /** The seller wallet → escrow wallet transfer has `QUANTUS_CONFIRMATIONS`. */
  | { type: 'LOCK_VERIFIED' }
  /** The seller's wallet cannot fund the lock (emptied after the match). Nothing moved. */
  | { type: 'LOCK_FAILED'; reason: string }
  /**
   * `lockDeadline` passed with nothing sent. `nothingDeposited` is kept for rows of the first
   * design (the seller never funded the escrow); the custodial worker passes `false`, because a
   * lock that was not even attempted is the platform's failure, not the seller's.
   */
  | { type: 'LOCK_TIMEOUT'; nothingDeposited: boolean }
  /**
   * Exact USDC transfer seen with enough confirmations. `logIndex` pins the `Transfer` log inside
   * the transaction; without it the whole transaction counts as claimed by this trade.
   */
  | { type: 'PAYMENT_CONFIRMED'; txHash: string; logIndex?: number }
  /** `payDeadline` passed without a confirmed payment. */
  | { type: 'PAY_TIMEOUT' }
  | { type: 'RELEASE_EXECUTED'; txHashes: readonly string[] }
  | { type: 'REFUND_EXECUTED'; txHashes: readonly string[] }
  | { type: 'DISPUTE_OPENED'; by: DisputeOpener }
  | { type: 'DISPUTE_RESOLVED'; resolution: DisputeResolution }
  /** The escrow no longer backs the trade, or a custody transfer ended in a way only a human can judge. */
  | { type: 'ESCROW_INVALIDATED'; reason: string }
  /** Brokered: the seller wallet → escrow transfer made after the payment has its confirmations. */
  | { type: 'DELIVERY_LOCKED' }
  /** Brokered: `deliveryDeadline` passed with no delivery on the wire. */
  | { type: 'DELIVERY_TIMEOUT' };

/** `p2p`: the seller's QTC is locked at the match. `broker`: bought and delivered after payment. */
export const TRADE_KINDS = ['p2p', 'broker'] as const;
export type TradeKind = (typeof TRADE_KINDS)[number];

/**
 * What the machine needs to know about the trade besides its state. `escrowFunded`: the escrow
 * holds the amount (a p2p trade from its lock on, a brokered one from its delivery lock on).
 */
export interface TradeContext {
  kind: TradeKind;
  escrowFunded: boolean;
}

const P2P: TradeContext = { kind: 'p2p', escrowFunded: true };

/**
 * Side effects the caller must apply in the same DB transaction as the state change.
 * The machine only names them; it never performs them.
 */
export type TradeEffect =
  | { type: 'RESTORE_OFFER_REMAINING' }
  | { type: 'WARN_SELLER'; reason: 'lock_timeout_no_deposit' | 'lock_insufficient_balance' }
  | { type: 'WARN_BUYER'; reason: 'pay_timeout' }
  | { type: 'SET_PAY_DEADLINE' }
  | { type: 'SET_DELIVERY_DEADLINE' }
  /** The release / refund intent row is written in the same transaction; the worker sends it. */
  | { type: 'RECORD_PAYMENT'; txHash: string; logIndex: number | null }
  | { type: 'START_RELEASE' }
  | { type: 'START_REFUND' }
  | {
      type: 'OPEN_SYSTEM_DISPUTE';
      reason: 'payment_during_refund' | 'escrow_invalidated' | 'delivery_timeout';
      detail: string;
    }
  | { type: 'INCREMENT_COMPLETED_TRADES' };

export type TransitionErrorCode = 'TERMINAL_STATE' | 'ILLEGAL_TRANSITION';

export interface TransitionError {
  code: TransitionErrorCode;
  from: TradeState;
  event: TradeEventType;
  message: string;
}

export type TransitionResult =
  | {
      ok: true;
      from: TradeState;
      state: TradeState;
      /** False when the event is accepted and recorded but the state stays the same. */
      changed: boolean;
      effects: TradeEffect[];
    }
  | { ok: false; error: TransitionError };

export function isTerminal(state: TradeState): state is TerminalTradeState {
  return (TERMINAL_TRADE_STATES as readonly TradeState[]).includes(state);
}

export const isTradeState = (value: unknown): value is TradeState =>
  typeof value === 'string' && (TRADE_STATES as readonly string[]).includes(value);

/** States from which a party may open a dispute. */
export const DISPUTABLE_STATES = [
  'AWAITING_PAYMENT',
  'AWAITING_DELIVERY',
  'RELEASING',
  'REFUNDING',
] as const;
export const canOpenDispute = (state: TradeState): boolean =>
  (DISPUTABLE_STATES as readonly TradeState[]).includes(state);

/** Non-terminal states: a user with a trade in one of these cannot change addresses. */
export const OPEN_TRADE_STATES: readonly TradeState[] = TRADE_STATES.filter((s) => !isTerminal(s));

type Accepted = { state: TradeState; effects: TradeEffect[] };

function next(state: TradeState, event: TradeEvent, ctx: TradeContext): Accepted | null {
  const broker = ctx.kind === 'broker';
  switch (event.type) {
    case 'LOCK_VERIFIED':
      return state === 'AWAITING_LOCK'
        ? { state: 'AWAITING_PAYMENT', effects: [{ type: 'SET_PAY_DEADLINE' }] }
        : null;

    case 'LOCK_FAILED':
      return state === 'AWAITING_LOCK'
        ? {
            state: 'CANCELLED',
            effects: [
              { type: 'RESTORE_OFFER_REMAINING' },
              { type: 'WARN_SELLER', reason: 'lock_insufficient_balance' },
            ],
          }
        : null;

    case 'LOCK_TIMEOUT': {
      if (state !== 'AWAITING_LOCK') return null;
      const effects: TradeEffect[] = [{ type: 'RESTORE_OFFER_REMAINING' }];
      if (event.nothingDeposited) {
        effects.push({ type: 'WARN_SELLER', reason: 'lock_timeout_no_deposit' });
      }
      return { state: 'CANCELLED', effects };
    }

    case 'PAYMENT_CONFIRMED': {
      const record: TradeEffect = {
        type: 'RECORD_PAYMENT',
        txHash: event.txHash,
        logIndex: event.logIndex ?? null,
      };
      if (state === 'AWAITING_PAYMENT') {
        return broker
          ? { state: 'AWAITING_DELIVERY', effects: [record, { type: 'SET_DELIVERY_DEADLINE' }] }
          : { state: 'RELEASING', effects: [record, { type: 'START_RELEASE' }] };
      }
      if (state === 'REFUNDING') {
        return {
          state: 'DISPUTED',
          effects: [
            record,
            {
              type: 'OPEN_SYSTEM_DISPUTE',
              reason: 'payment_during_refund',
              detail: `Payment ${event.txHash} confirmed after the pay deadline, before the refund executed`,
            },
          ],
        };
      }
      if (state === 'DISPUTED') return { state: 'DISPUTED', effects: [record] };
      return null;
    }

    case 'PAY_TIMEOUT':
      if (state !== 'AWAITING_PAYMENT') return null;
      // Brokered: nothing was locked, so there is nothing to refund.
      return broker
        ? {
            state: 'CANCELLED',
            effects: [
              { type: 'WARN_BUYER', reason: 'pay_timeout' },
              { type: 'RESTORE_OFFER_REMAINING' },
            ],
          }
        : {
            state: 'REFUNDING',
            effects: [{ type: 'WARN_BUYER', reason: 'pay_timeout' }, { type: 'START_REFUND' }],
          };

    case 'DELIVERY_LOCKED':
      return state === 'AWAITING_DELIVERY' && broker
        ? { state: 'RELEASING', effects: [{ type: 'START_RELEASE' }] }
        : null;

    case 'DELIVERY_TIMEOUT':
      return state === 'AWAITING_DELIVERY'
        ? {
            state: 'DISPUTED',
            effects: [
              {
                type: 'OPEN_SYSTEM_DISPUTE',
                reason: 'delivery_timeout',
                detail:
                  'The buyer paid but the QTC was not delivered in time. Deliver it, or refund the USDC by hand.',
              },
            ],
          }
        : null;

    case 'RELEASE_EXECUTED':
      return state === 'RELEASING'
        ? { state: 'COMPLETED', effects: [{ type: 'INCREMENT_COMPLETED_TRADES' }] }
        : null;

    case 'REFUND_EXECUTED':
      return state === 'REFUNDING'
        ? { state: 'REFUNDED', effects: [{ type: 'RESTORE_OFFER_REMAINING' }] }
        : null;

    case 'DISPUTE_OPENED':
      return canOpenDispute(state) ? { state: 'DISPUTED', effects: [] } : null;

    case 'DISPUTE_RESOLVED':
      if (state !== 'DISPUTED') return null;
      // A brokered trade disputed before its delivery lock: the escrow holds nothing. Releasing
      // means delivering again; refunding means the USDC was returned by hand.
      if (broker && !ctx.escrowFunded) {
        return event.resolution === 'release'
          ? { state: 'AWAITING_DELIVERY', effects: [{ type: 'SET_DELIVERY_DEADLINE' }] }
          : { state: 'REFUNDED', effects: [{ type: 'RESTORE_OFFER_REMAINING' }] };
      }
      return event.resolution === 'release'
        ? { state: 'RELEASING', effects: [{ type: 'START_RELEASE' }] }
        : { state: 'REFUNDING', effects: [{ type: 'START_REFUND' }] };

    case 'ESCROW_INVALIDATED':
      return state === 'AWAITING_PAYMENT' ||
        state === 'AWAITING_DELIVERY' ||
        state === 'RELEASING' ||
        state === 'REFUNDING'
        ? {
            state: 'DISPUTED',
            effects: [
              { type: 'OPEN_SYSTEM_DISPUTE', reason: 'escrow_invalidated', detail: event.reason },
            ],
          }
        : null;
  }
}

/** Apply `event` to `state`. Illegal combinations return an explicit error and never throw. */
export function transition(
  state: TradeState,
  event: TradeEvent,
  ctx: TradeContext = P2P,
): TransitionResult {
  if (isTerminal(state)) {
    return {
      ok: false,
      error: {
        code: 'TERMINAL_STATE',
        from: state,
        event: event.type,
        message: `Trade is ${state}; ${event.type} cannot be applied to a finished trade`,
      },
    };
  }
  const accepted = next(state, event, ctx);
  if (!accepted) {
    return {
      ok: false,
      error: {
        code: 'ILLEGAL_TRANSITION',
        from: state,
        event: event.type,
        message: `${event.type} is not allowed while the trade is ${state}`,
      },
    };
  }
  return {
    ok: true,
    from: state,
    state: accepted.state,
    changed: accepted.state !== state,
    effects: accepted.effects,
  };
}

/** Static table of accepted (state, event) pairs → resulting state(s). Source of truth for tests and docs. */
export const TRANSITION_TABLE: Readonly<
  Record<TradeState, Partial<Record<TradeEventType, readonly TradeState[]>>>
> = {
  AWAITING_LOCK: {
    LOCK_VERIFIED: ['AWAITING_PAYMENT'],
    LOCK_FAILED: ['CANCELLED'],
    LOCK_TIMEOUT: ['CANCELLED'],
  },
  AWAITING_PAYMENT: {
    PAYMENT_CONFIRMED: ['RELEASING', 'AWAITING_DELIVERY'],
    PAY_TIMEOUT: ['REFUNDING', 'CANCELLED'],
    DISPUTE_OPENED: ['DISPUTED'],
    ESCROW_INVALIDATED: ['DISPUTED'],
  },
  AWAITING_DELIVERY: {
    DELIVERY_LOCKED: ['RELEASING'],
    DELIVERY_TIMEOUT: ['DISPUTED'],
    DISPUTE_OPENED: ['DISPUTED'],
    ESCROW_INVALIDATED: ['DISPUTED'],
  },
  RELEASING: {
    RELEASE_EXECUTED: ['COMPLETED'],
    DISPUTE_OPENED: ['DISPUTED'],
    ESCROW_INVALIDATED: ['DISPUTED'],
  },
  REFUNDING: {
    REFUND_EXECUTED: ['REFUNDED'],
    PAYMENT_CONFIRMED: ['DISPUTED'],
    DISPUTE_OPENED: ['DISPUTED'],
    ESCROW_INVALIDATED: ['DISPUTED'],
  },
  DISPUTED: {
    PAYMENT_CONFIRMED: ['DISPUTED'],
    DISPUTE_RESOLVED: ['RELEASING', 'REFUNDING', 'AWAITING_DELIVERY', 'REFUNDED'],
  },
  COMPLETED: {},
  CANCELLED: {},
  REFUNDED: {},
};

export const allowedEvents = (state: TradeState): TradeEventType[] =>
  Object.keys(TRANSITION_TABLE[state]) as TradeEventType[];

export const canApply = (state: TradeState, event: TradeEventType): boolean =>
  TRANSITION_TABLE[state][event] !== undefined;

/** The four steps of the public escrow timeline: Match → Lock → Pay → Release. */
export const ESCROW_STEPS = ['match', 'lock', 'pay', 'release'] as const;
export type EscrowStep = (typeof ESCROW_STEPS)[number];

export interface StepperPosition {
  /** Step currently in progress, or `null` once the trade is finished or off the happy path. */
  current: EscrowStep | null;
  completed: EscrowStep[];
  outcome: 'in_progress' | 'completed' | 'cancelled' | 'refunding' | 'refunded' | 'disputed';
}

/**
 * Where a trade sits on the Match → Lock → Pay → Release stepper. A brokered trade pays before
 * its lock, which is the delivery.
 */
export function stepperPosition(state: TradeState, kind: TradeKind = 'p2p'): StepperPosition {
  if (kind === 'broker') {
    switch (state) {
      case 'AWAITING_PAYMENT':
        return { current: 'pay', completed: ['match'], outcome: 'in_progress' };
      case 'AWAITING_DELIVERY':
        return { current: 'lock', completed: ['match', 'pay'], outcome: 'in_progress' };
      case 'CANCELLED':
        return { current: null, completed: ['match'], outcome: 'cancelled' };
      case 'DISPUTED':
        return { current: null, completed: ['match', 'pay'], outcome: 'disputed' };
      default:
        break;
    }
  }
  switch (state) {
    case 'AWAITING_LOCK':
      return { current: 'lock', completed: ['match'], outcome: 'in_progress' };
    case 'AWAITING_PAYMENT':
      return { current: 'pay', completed: ['match', 'lock'], outcome: 'in_progress' };
    case 'AWAITING_DELIVERY':
      return { current: 'lock', completed: ['match', 'pay'], outcome: 'in_progress' };
    case 'RELEASING':
      return { current: 'release', completed: ['match', 'lock', 'pay'], outcome: 'in_progress' };
    case 'COMPLETED':
      return { current: null, completed: [...ESCROW_STEPS], outcome: 'completed' };
    case 'CANCELLED':
      return { current: null, completed: ['match'], outcome: 'cancelled' };
    case 'REFUNDING':
      return { current: null, completed: ['match', 'lock'], outcome: 'refunding' };
    case 'REFUNDED':
      return { current: null, completed: ['match', 'lock'], outcome: 'refunded' };
    case 'DISPUTED':
      return { current: null, completed: ['match', 'lock'], outcome: 'disputed' };
  }
}
