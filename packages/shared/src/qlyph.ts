/**
 * Qlyph Seals — the collection struck by settlements.
 *
 * One settlement, one seal. Everything is drawn from values that can never change (the trade id,
 * the amount, the price, the total, the side), so a seal is reproducible from its trade alone:
 * whatever carries it later — an inscription, an asset of the native protocol — only has to carry
 * the id, never the picture.
 *
 * Rarity is a draw, not a ladder. Every layer picks one option out of a weighted bag, and what the
 * settlement was worth only shifts the odds: paying more lifts the weight of the scarce options and
 * never guarantees them, and the cheapest trade in the book can still strike a Mythic. The grade
 * printed on a seal is computed from the *base* odds, so it says how unlikely the piece is, not how
 * much was paid for it.
 */

export const QLYPH_STAGES = ['match', 'lock', 'pay', 'release'] as const;
export type QlyphStage = (typeof QLYPH_STAGES)[number];

/** Colour roles a shape can take; the renderer maps them to the palette it has. */
export type QlyphInk = 'primary' | 'secondary' | 'ink' | 'muted' | 'guide';

export interface QlyphOption<T extends string> {
  id: T;
  label: string;
  /** Weight in the bag for a settlement of no size at all. */
  base: number;
  /** How much of that weight a full-size settlement adds. Scarce options lift the most. */
  lift: number;
}

const options = <T extends string>(list: ReadonlyArray<QlyphOption<T>>) => list;

/** The backdrop inside the frame. */
export const FIELDS = options([
  { id: 'void', label: 'Void', base: 44, lift: 0 },
  { id: 'lattice', label: 'Lattice', base: 30, lift: 2 },
  { id: 'rings', label: 'Rings', base: 16, lift: 8 },
  { id: 'rays', label: 'Rays', base: 7, lift: 22 },
  { id: 'dust', label: 'Dust', base: 3, lift: 38 },
] as const);

/** The boundary of the medallion. */
export const FRAMES = options([
  { id: 'ring', label: 'Ring', base: 46, lift: 0 },
  { id: 'double', label: 'Double ring', base: 28, lift: 3 },
  { id: 'hex', label: 'Hex', base: 15, lift: 10 },
  { id: 'rosette', label: 'Rosette', base: 8, lift: 24 },
  { id: 'eclipse', label: 'Eclipse', base: 3, lift: 40 },
] as const);

/** What sits at the centre. */
export const CORES = options([
  { id: 'sigil', label: 'Sigil', base: 40, lift: 0 },
  { id: 'monolith', label: 'Monolith', base: 26, lift: 4 },
  { id: 'lens', label: 'Lens', base: 18, lift: 10 },
  { id: 'prism', label: 'Prism', base: 11, lift: 22 },
  { id: 'orbit', label: 'Orbit', base: 5, lift: 36 },
] as const);

/** Which inks the seal is struck in. */
export const INKS = options([
  { id: 'mono', label: 'Mono', base: 40, lift: 0 },
  { id: 'glacier', label: 'Glacier', base: 14, lift: 3 },
  { id: 'lilac', label: 'Lilac', base: 14, lift: 3 },
  { id: 'sand', label: 'Sand', base: 14, lift: 3 },
  { id: 'sage', label: 'Sage', base: 14, lift: 3 },
  { id: 'duotone', label: 'Duotone', base: 3, lift: 22 },
  { id: 'spectrum', label: 'Spectrum', base: 1, lift: 34 },
] as const);

/** The ornament outside the frame. */
export const CHARGES = options([
  { id: 'bare', label: 'Bare', base: 46, lift: 0 },
  { id: 'satellites', label: 'Satellites', base: 26, lift: 4 },
  { id: 'corners', label: 'Corners', base: 16, lift: 10 },
  { id: 'crown', label: 'Crown', base: 9, lift: 24 },
  { id: 'halo', label: 'Halo', base: 3, lift: 40 },
] as const);

export type QlyphField = (typeof FIELDS)[number]['id'];
export type QlyphFrame = (typeof FRAMES)[number]['id'];
export type QlyphCore = (typeof CORES)[number]['id'];
export type QlyphInkName = (typeof INKS)[number]['id'];
export type QlyphCharge = (typeof CHARGES)[number]['id'];

export interface QlyphTraits {
  field: QlyphField;
  frame: QlyphFrame;
  core: QlyphCore;
  ink: QlyphInkName;
  charge: QlyphCharge;
}

/** Ascending; a seal takes the last grade its score reaches. */
export const QLYPH_GRADES = [
  { name: 'Common', minScore: 0 },
  { name: 'Uncommon', minScore: 11 },
  { name: 'Rare', minScore: 14 },
  { name: 'Epic', minScore: 17 },
  { name: 'Mythic', minScore: 20.5 },
] as const;

export type QlyphGrade = (typeof QLYPH_GRADES)[number]['name'];

export interface QlyphSeed {
  /** Trade id. */
  id: string;
  /** Base units as the API sends them: planck for the amount, micro for price and total. */
  amount: string;
  price: string;
  quoteTotal: string;
  side: 'buy' | 'sell';
}

export interface QlyphShape {
  kind: 'circle' | 'rect' | 'path' | 'polygon';
  /** circle */
  cx?: number;
  cy?: number;
  r?: number;
  /** rect */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rx?: number;
  /** path / polygon */
  d?: string;
  points?: string;
  fill?: QlyphInk;
  stroke?: QlyphInk;
  width?: number;
  round?: boolean;
}

export interface QlyphSeal {
  traits: QlyphTraits;
  /** Rarity score of the combination under the base odds. Higher is scarcer. */
  score: number;
  grade: QlyphGrade;
  /** 0 … 1: how far the settlement moved the odds. */
  luck: number;
  /** Six characters of the hash — the name of the piece. */
  code: string;
  /** Everything to draw, back to front, in a 100 × 100 box. */
  shapes: QlyphShape[];
}

const MICRO = 1_000_000n;
const CENTRE = 50;
const RIM = 44;
const CORE_SPAN = 34;

/** FNV-1a, 32 bits. Small, stable, and enough to separate two trade ids. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: one seed in, a repeatable stream of numbers in [0, 1) out. */
function stream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedString = (seed: QlyphSeed): string =>
  `${seed.id}|${seed.amount}|${seed.price}|${seed.quoteTotal}|${seed.side}`;

/**
 * How much the settlement bends the odds, from its USDC total. Logarithmic, so the first hundreds
 * of dollars buy most of the advantage and a whale does not own the collection: 10 USDC ≈ 0.26,
 * 100 ≈ 0.5, 1 000 ≈ 0.75, 10 000 and above ≈ 1.
 */
export function qlyphLuck(quoteTotalMicro: string): number {
  let usdc: number;
  try {
    usdc = Number(BigInt(quoteTotalMicro) / MICRO);
  } catch {
    usdc = 0;
  }
  if (!Number.isFinite(usdc) || usdc <= 0) return 0;
  return Math.min(1, Math.log10(1 + usdc) / 4);
}

/** Probability of each option under the base odds — what the grade is measured against. */
function baseOdds<T extends string>(bag: ReadonlyArray<QlyphOption<T>>): Map<T, number> {
  const total = bag.reduce((sum, option) => sum + option.base, 0);
  return new Map(bag.map((option) => [option.id, option.base / total]));
}

/** Draw one option. Weights are the base plus the part of the lift the settlement earned. */
function pick<T extends string>(
  bag: ReadonlyArray<QlyphOption<T>>,
  next: () => number,
  luck: number,
): QlyphOption<T> {
  const weights = bag.map((option) => option.base + option.lift * luck);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = next() * total;
  for (let index = 0; index < bag.length; index += 1) {
    cursor -= weights[index] ?? 0;
    if (cursor <= 0) return bag[index] as QlyphOption<T>;
  }
  return bag[bag.length - 1] as QlyphOption<T>;
}

const point = (radius: number, degrees: number): [number, number] => {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [CENTRE + radius * Math.cos(radians), CENTRE + radius * Math.sin(radians)];
};

const fixed = (value: number): string => value.toFixed(2);

function arc(radius: number, start: number, sweep: number): string {
  const [x0, y0] = point(radius, start);
  const [x1, y1] = point(radius, start + sweep);
  return `M ${fixed(x0)} ${fixed(y0)} A ${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${fixed(x1)} ${fixed(y1)}`;
}

function spoke(from: number, to: number, degrees: number): string {
  const [x0, y0] = point(from, degrees);
  const [x1, y1] = point(to, degrees);
  return `M ${fixed(x0)} ${fixed(y0)} L ${fixed(x1)} ${fixed(y1)}`;
}

function fieldShapes(field: QlyphField, next: () => number): QlyphShape[] {
  switch (field) {
    case 'void':
      return [];
    case 'lattice': {
      const dots: QlyphShape[] = [];
      for (let x = CENTRE - 36; x <= CENTRE + 36; x += 6) {
        for (let y = CENTRE - 36; y <= CENTRE + 36; y += 6) {
          if (Math.hypot(x - CENTRE, y - CENTRE) > RIM - 5) continue;
          dots.push({ kind: 'circle', cx: x, cy: y, r: 0.45, fill: 'guide' });
        }
      }
      return dots;
    }
    case 'rings':
      return [12, 20, 28, 36].map((r) => ({
        kind: 'circle' as const,
        cx: CENTRE,
        cy: CENTRE,
        r,
        stroke: 'guide' as const,
        width: 0.4,
      }));
    case 'rays': {
      const count = 24;
      const offset = next() * 15;
      return Array.from({ length: count }, (_, index) => ({
        kind: 'path' as const,
        d: spoke(13, RIM - 5, (360 / count) * index + offset),
        stroke: 'guide' as const,
        width: 0.4,
      }));
    }
    case 'dust':
      return Array.from({ length: 48 }, () => {
        const [x, y] = point(10 + next() * (RIM - 16), next() * 360);
        return {
          kind: 'circle' as const,
          cx: x,
          cy: y,
          r: 0.35 + next() * 0.5,
          fill: 'muted' as const,
        };
      });
  }
}

function frameShapes(frame: QlyphFrame, next: () => number): QlyphShape[] {
  switch (frame) {
    case 'ring':
      return [{ kind: 'circle', cx: CENTRE, cy: CENTRE, r: RIM, stroke: 'primary', width: 1.4 }];
    case 'double':
      return [
        { kind: 'circle', cx: CENTRE, cy: CENTRE, r: RIM, stroke: 'primary', width: 1.4 },
        { kind: 'circle', cx: CENTRE, cy: CENTRE, r: RIM - 3.2, stroke: 'secondary', width: 0.7 },
      ];
    case 'hex': {
      const points = Array.from({ length: 6 }, (_, index) => {
        const [x, y] = point(RIM, 60 * index);
        return `${fixed(x)},${fixed(y)}`;
      }).join(' ');
      return [
        { kind: 'polygon', points, stroke: 'primary', width: 1.4 },
        { kind: 'circle', cx: CENTRE, cy: CENTRE, r: RIM - 6, stroke: 'guide', width: 0.5 },
      ];
    }
    case 'rosette': {
      const count = 12;
      const offset = next() * 30;
      return [
        { kind: 'circle', cx: CENTRE, cy: CENTRE, r: RIM - 4, stroke: 'primary', width: 1 },
        ...Array.from({ length: count }, (_, index) => {
          const [x, y] = point(RIM - 4, (360 / count) * index + offset);
          return {
            kind: 'circle' as const,
            cx: x,
            cy: y,
            r: 2.4,
            stroke: 'secondary' as const,
            width: 0.8,
          };
        }),
      ];
    }
    case 'eclipse': {
      const start = next() * 360;
      return [
        { kind: 'circle', cx: CENTRE, cy: CENTRE, r: RIM, stroke: 'guide', width: 0.6 },
        { kind: 'path', d: arc(RIM, start, 250), stroke: 'primary', width: 4.4, round: true },
        {
          kind: 'path',
          d: arc(RIM, start + 262, 70),
          stroke: 'secondary',
          width: 1.6,
          round: true,
        },
      ];
    }
  }
}

function coreShapes(core: QlyphCore, next: () => number, dense: boolean): QlyphShape[] {
  switch (core) {
    case 'sigil': {
      // Half the grid plus the axis column, then mirrored: a sigil reads as one figure, not noise.
      const grid = 7;
      const size = CORE_SPAN / grid;
      const origin = CENTRE - CORE_SPAN / 2;
      const density = dense ? 0.52 : 0.42;
      const filled: boolean[] = Array.from({ length: grid * grid }, () => false);
      for (let row = 0; row < grid; row += 1) {
        for (let column = 0; column < Math.ceil(grid / 2); column += 1) {
          if (next() >= density) continue;
          filled[row * grid + column] = true;
          filled[row * grid + (grid - 1 - column)] = true;
        }
      }
      const middle = (grid - 1) / 2;
      if (!filled.slice(middle * grid, middle * grid + grid).some(Boolean)) {
        filled[middle * grid + middle] = true;
      }
      return filled.flatMap((on, index) =>
        on
          ? [
              {
                kind: 'rect' as const,
                x: origin + (index % grid) * size,
                y: origin + Math.floor(index / grid) * size,
                w: size * 0.72,
                h: size * 0.72,
                rx: size * 0.18,
                fill: 'ink' as const,
              },
            ]
          : [],
      );
    }
    case 'monolith': {
      const width = 7 + next() * 3;
      const height = 26;
      return [
        {
          kind: 'rect',
          x: CENTRE - width / 2,
          y: CENTRE - height / 2,
          w: width,
          h: height,
          rx: 1.4,
          fill: 'ink',
        },
        // A notch cut out of the shaft and a base it stands on.
        {
          kind: 'rect',
          x: CENTRE - width / 2,
          y: CENTRE + height / 2 - 7,
          w: width,
          h: 2.2,
          fill: 'primary',
        },
        {
          kind: 'rect',
          x: CENTRE - width * 1.1,
          y: CENTRE + height / 2 + 1.6,
          w: width * 2.2,
          h: 1.6,
          rx: 0.8,
          fill: 'secondary',
        },
      ];
    }
    case 'lens':
      return [
        { kind: 'path', d: arc(17, 200, 140), stroke: 'ink', width: 1.6, round: true },
        { kind: 'path', d: arc(17, 20, 140), stroke: 'ink', width: 1.6, round: true },
        { kind: 'circle', cx: CENTRE, cy: CENTRE, r: 9, stroke: 'secondary', width: 0.7 },
        { kind: 'circle', cx: CENTRE, cy: CENTRE, r: 4.2, fill: 'primary' },
      ];
    case 'prism': {
      const outer = Array.from({ length: 3 }, (_, index) => {
        const [x, y] = point(19, 120 * index);
        return `${fixed(x)},${fixed(y)}`;
      }).join(' ');
      const inner = Array.from({ length: 3 }, (_, index) => {
        const [x, y] = point(10, 120 * index + 60);
        return `${fixed(x)},${fixed(y)}`;
      }).join(' ');
      return [
        { kind: 'polygon', points: outer, stroke: 'ink', width: 1.6 },
        { kind: 'polygon', points: inner, stroke: 'secondary', width: 0.9 },
        { kind: 'circle', cx: CENTRE, cy: CENTRE, r: 2.2, fill: 'primary' },
      ];
    }
    case 'orbit': {
      const shapes: QlyphShape[] = [];
      for (const radius of [10, 15, 20]) {
        shapes.push({
          kind: 'circle',
          cx: CENTRE,
          cy: CENTRE,
          r: radius,
          stroke: 'secondary',
          width: 0.6,
        });
        const [x, y] = point(radius, next() * 360);
        shapes.push({ kind: 'circle', cx: x, cy: y, r: 1.8, fill: 'ink' });
      }
      shapes.push({ kind: 'circle', cx: CENTRE, cy: CENTRE, r: 4.6, fill: 'primary' });
      return shapes;
    }
  }
}

function chargeShapes(charge: QlyphCharge, next: () => number): QlyphShape[] {
  switch (charge) {
    case 'bare':
      return [];
    case 'satellites': {
      const offset = next() * 360;
      return Array.from({ length: 3 }, (_, index) => {
        const [x, y] = point(RIM + 4, offset + 120 * index);
        return { kind: 'circle' as const, cx: x, cy: y, r: 1.9, fill: 'primary' as const };
      });
    }
    case 'corners':
      return [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ].map(([sx, sy]) => ({
        kind: 'rect' as const,
        x: CENTRE + (sx ?? 1) * RIM * Math.SQRT1_2 - 2.4,
        y: CENTRE + (sy ?? 1) * RIM * Math.SQRT1_2 - 2.4,
        w: 4.8,
        h: 4.8,
        rx: 1,
        fill: 'ink' as const,
      }));
    case 'crown': {
      const count = 24;
      const offset = next() * 15;
      return Array.from({ length: count }, (_, index) => ({
        kind: 'path' as const,
        d: spoke(RIM + 2, RIM + (index % 3 === 0 ? 5.5 : 3.5), (360 / count) * index + offset),
        stroke: 'muted' as const,
        width: 0.8,
        round: true,
      }));
    }
    case 'halo': {
      const count = 48;
      return [
        { kind: 'circle', cx: CENTRE, cy: CENTRE, r: RIM + 3, stroke: 'guide', width: 0.5 },
        ...Array.from({ length: count }, (_, index) => {
          const [x, y] = point(RIM + 3, (360 / count) * index);
          return { kind: 'circle' as const, cx: x, cy: y, r: 0.6, fill: 'primary' as const };
        }),
      ];
    }
  }
}

const gradeOf = (score: number): QlyphGrade => {
  let grade: QlyphGrade = 'Common';
  for (const step of QLYPH_GRADES) if (score >= step.minScore) grade = step.name;
  return grade;
};

/**
 * Strike the seal of a settlement. The same trade always gives the same piece; a larger settlement
 * only enters the draw with better odds.
 */
export function qlyphSeal(seed: QlyphSeed): QlyphSeal {
  const digest = hash(seedString(seed));
  const next = stream(digest);
  const luck = qlyphLuck(seed.quoteTotal);

  const field = pick(FIELDS, next, luck);
  const frame = pick(FRAMES, next, luck);
  const core = pick(CORES, next, luck);
  const ink = pick(INKS, next, luck);
  const charge = pick(CHARGES, next, luck);

  // Scarcity is read under the base odds, so a grade says how unlikely the piece is, not what it cost.
  const odds =
    (baseOdds(FIELDS).get(field.id) ?? 1) *
    (baseOdds(FRAMES).get(frame.id) ?? 1) *
    (baseOdds(CORES).get(core.id) ?? 1) *
    (baseOdds(INKS).get(ink.id) ?? 1) *
    (baseOdds(CHARGES).get(charge.id) ?? 1);
  const score = Math.round(-Math.log2(odds) * 10) / 10;

  return {
    traits: { field: field.id, frame: frame.id, core: core.id, ink: ink.id, charge: charge.id },
    score,
    grade: gradeOf(score),
    luck,
    code: digest.toString(16).padStart(8, '0').slice(0, 6).toUpperCase(),
    shapes: [
      ...fieldShapes(field.id, next),
      ...frameShapes(frame.id, next),
      ...coreShapes(core.id, next, luck > 0.5),
      ...chargeShapes(charge.id, next),
    ],
  };
}

export interface QlyphPalette {
  stages: Readonly<Record<QlyphStage, string>>;
  ink: string;
  muted: string;
  guide: string;
}

/** Resolve the ink roles of a seal against a palette. */
export function qlyphInks(
  ink: QlyphInkName,
  palette: QlyphPalette,
): Readonly<Record<QlyphInk, string>> {
  const { stages } = palette;
  const pair: Record<QlyphInkName, [string, string]> = {
    mono: [palette.ink, palette.muted],
    glacier: [stages.match, palette.ink],
    lilac: [stages.lock, palette.ink],
    sand: [stages.pay, palette.ink],
    sage: [stages.release, palette.ink],
    duotone: [stages.lock, stages.pay],
    spectrum: [stages.match, stages.release],
  };
  const [primary, secondary] = pair[ink];
  return { primary, secondary, ink: palette.ink, muted: palette.muted, guide: palette.guide };
}

/** Human-readable traits, for the ticket to list what the piece is made of. */
export function qlyphTraitList(traits: QlyphTraits): Array<{ label: string; value: string }> {
  const find = <T extends string>(bag: ReadonlyArray<QlyphOption<T>>, id: T): string =>
    bag.find((option) => option.id === id)?.label ?? id;
  return [
    { label: 'Frame', value: find(FRAMES, traits.frame) },
    { label: 'Core', value: find(CORES, traits.core) },
    { label: 'Field', value: find(FIELDS, traits.field) },
    { label: 'Ink', value: find(INKS, traits.ink) },
    { label: 'Charge', value: find(CHARGES, traits.charge) },
  ];
}
