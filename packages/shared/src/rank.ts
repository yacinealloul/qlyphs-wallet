/**
 * Rank → open-offer slots (SPEC §3) and the warning ladder.
 * rank 0: <3 trades → 2 offers; rank 1: ≥3 → 5; rank 2: ≥15 → 10; rank 3: ≥50 → 25.
 */

export type Rank = 0 | 1 | 2 | 3;
export type AccountStatus = 'active' | 'restricted' | 'banned';

export interface RankTier {
  rank: Rank;
  /** Completed trades needed to reach this rank. */
  minTrades: number;
  /** Open offers allowed at this rank. */
  slots: number;
}

export const RANK_TIERS: readonly RankTier[] = [
  { rank: 0, minTrades: 0, slots: 2 },
  { rank: 1, minTrades: 3, slots: 5 },
  { rank: 2, minTrades: 15, slots: 10 },
  { rank: 3, minTrades: 50, slots: 25 },
] as const;

const BASE_TIER: RankTier = { rank: 0, minTrades: 0, slots: 2 };

function assertTradeCount(completedTrades: number): void {
  if (!Number.isInteger(completedTrades) || completedTrades < 0) {
    throw new RangeError('completedTrades must be a non-negative integer');
  }
}

export function tierForTrades(completedTrades: number): RankTier {
  assertTradeCount(completedTrades);
  let current = BASE_TIER;
  for (const tier of RANK_TIERS) {
    if (completedTrades >= tier.minTrades) current = tier;
  }
  return current;
}

export const rankForTrades = (completedTrades: number): Rank => tierForTrades(completedTrades).rank;

export function slotsForRank(rank: number): number {
  const tier = RANK_TIERS.find((t) => t.rank === rank);
  if (!tier) throw new RangeError(`Unknown rank ${rank}`);
  return tier.slots;
}

/** Open-offer slots for a user. Restricted and banned users cannot create offers. */
export function offerSlots(user: { completedTrades: number; status: AccountStatus }): number {
  if (user.status !== 'active') return 0;
  return tierForTrades(user.completedTrades).slots;
}

/** The next tier and how many trades are missing, or `null` at the top rank. */
export function nextTier(completedTrades: number): { tier: RankTier; tradesNeeded: number } | null {
  const current = tierForTrades(completedTrades);
  const next = RANK_TIERS.find((t) => t.rank === current.rank + 1);
  return next ? { tier: next, tradesNeeded: next.minTrades - completedTrades } : null;
}

export type WarningConsequence = 'none' | 'notice' | 'restricted' | 'banned';

/** Warnings: 1 → notice, 2 → restricted 7 days, 3+ → banned. */
export function warningConsequence(warnings: number): WarningConsequence {
  if (!Number.isInteger(warnings) || warnings < 0) {
    throw new RangeError('warnings must be a non-negative integer');
  }
  if (warnings === 0) return 'none';
  if (warnings === 1) return 'notice';
  if (warnings === 2) return 'restricted';
  return 'banned';
}
