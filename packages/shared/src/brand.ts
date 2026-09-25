/**
 * Brand and product naming, in one place. Qlyphs is the parent brand; each product hangs under it on
 * its own subdomain. "Quantus", "QTC" and other network terms are not branding and do not live here.
 *
 * Domains below are the production targets, for copy and documentation only. Runtime origins always
 * come from the environment (`WEB_ORIGIN`, `APP_ORIGIN`, `API_URL`), never from these constants.
 */
export const BRAND = {
  name: 'Qlyphs',
  tagline: 'Native markets and assets on Quantus',
  description:
    'Qlyphs is building the application layer for Quantus, starting with QTC liquidity.',
  domain: 'qlyphs.com',
  /**
   * The company or person operating the service. Not decided yet, and not necessarily "Qlyphs":
   * legal pages must read this, never `name`. TODO(legal): set before launch.
   */
  legalEntity: null as string | null,
} as const;

export interface BrandProduct {
  /** Full product name, e.g. "Qlyphs OTC". */
  name: string;
  /** The part after the parent brand, rendered as the wordmark suffix, e.g. "OTC". */
  suffix: string;
  description: string;
  domain: string;
}

/** Launched products only. A future product is added here when it ships, not before. */
export const PRODUCTS = {
  otc: {
    name: `${BRAND.name} OTC`,
    suffix: 'OTC',
    description: 'Buy and sell QTC directly against USDT.',
    domain: `otc.${BRAND.domain}`,
  },
} as const satisfies Record<string, BrandProduct>;

export type ProductId = keyof typeof PRODUCTS;
