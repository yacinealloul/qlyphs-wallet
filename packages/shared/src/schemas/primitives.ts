/** Building blocks shared by every API schema. JSON carries amounts as base-unit integer strings. */
import { z } from 'zod';
import { PASSWORD_MIN_LENGTH, PRICE_TICK_MICRO } from '../constants';

/** Opaque entity id (the API issues UUIDs; clients must not parse them). */
export const IdSchema = z.string().min(1).max(64);
export type Id = z.infer<typeof IdSchema>;

export const IsoDateSchema = z.iso.datetime({ offset: true });
export type IsoDate = z.infer<typeof IsoDateSchema>;

const BASE_UNIT_RE = /^(0|[1-9]\d{0,39})$/;

/** Non-negative base-unit integer as a decimal string. */
export const BaseUnitStringSchema = z
  .string()
  .regex(BASE_UNIT_RE, 'Expected a base-unit integer string');
/** QTC amount in planck. */
export const PlanckStringSchema = BaseUnitStringSchema;
/** USDC amount in micro. */
export const MicroStringSchema = BaseUnitStringSchema;

const positive = (v: string): boolean => BASE_UNIT_RE.test(v) && BigInt(v) > 0n;

export const PositivePlanckStringSchema = PlanckStringSchema.refine(positive, {
  message: 'Amount must be greater than zero',
});

/** USDC micro per 1 QTC, strictly positive, on the $0.01 tick. */
export const PriceStringSchema = MicroStringSchema.refine(positive, {
  message: 'Price must be greater than zero',
}).refine((v) => !BASE_UNIT_RE.test(v) || BigInt(v) % PRICE_TICK_MICRO === 0n, {
  message: 'Price must be a multiple of $0.01',
});

export type PlanckString = string;
export type MicroString = string;
export type PriceString = string;

/**
 * Quantus SS58 address, prefix 189 (`qz…`). Shape check only: the checksum is verified server-side
 * with `ChainAdapter.isValidAddress`. Mock adapters must emit addresses matching this shape.
 */
export const QuantusAddressSchema = z
  .string()
  .regex(/^qz[1-9A-HJ-NP-Za-km-z]{30,62}$/, 'Expected a Quantus address (starts with "qz")');
export type QuantusAddress = z.infer<typeof QuantusAddressSchema>;

/** EVM address, shape check only; EIP-55 checksum is verified and normalised by `EvmAdapter`. */
export const EvmAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Expected a 0x-prefixed EVM address');
export type EvmAddress = z.infer<typeof EvmAddressSchema>;

export const HexSchema = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2})*$/, 'Expected 0x-prefixed hex bytes');
export type Hex = z.infer<typeof HexSchema>;

/** 32-byte hash (tx hash, call hash, block hash) on either chain. */
export const Hash32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'Expected a 32-byte 0x-prefixed hash');
export type Hash32 = z.infer<typeof Hash32Schema>;

export const UsernameSchema = z
  .string()
  .regex(/^[a-z0-9_]{3,20}$/, 'Username must be 3–20 characters: a–z, 0–9 or _');
/** Lower-cased in place (no transform, so the schema stays representable in OpenAPI). */
export const EmailSchema = z.email().max(254).toLowerCase();
export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(256);
export const TokenSchema = z.string().min(16).max(256);

export const CursorSchema = z.string().min(1).max(512);
export const LimitSchema = z.coerce.number().int().min(1).max(100).default(50);

export const PaginationQuerySchema = z.object({
  cursor: CursorSchema.optional(),
  limit: LimitSchema,
});

/** Cursor-paginated list envelope. */
export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: CursorSchema.nullable(),
  });
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export const OkResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponseSchema>;
