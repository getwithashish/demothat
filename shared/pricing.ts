// What is for sale, and how a price is rendered.
//
// `GET /v1/products` (contract 2.1.0) is the server's own answer, and the source
// of truth for both the product ids and the credits each one grants. The money
// comes from the payment provider, so a price is *rendered* here, never charged
// from a client number.
//
// Shared by the main process (which fetches the list) and the renderer (which
// shows it in the Buy credits dialog), so both agree on the arithmetic.

export interface ProductPrice {
  /** Integer in the smallest denomination of `currency`. */
  amountMinor: number
  currency: string
  /** 2 for USD, 0 for zero-decimal currencies such as JPY. */
  minorUnitExponent: number
  /** True when the amount is a floor, i.e. pay-what-you-want. */
  isMinimum: boolean
}

export interface Product {
  productId: string
  kind: 'first_purchase' | 'topup'
  /** Credits granted by one unit; the server charges from this, not from us. */
  credits: number
  name?: string
  description?: string
  isRecurring?: boolean
  /** Null when the payment provider could not be reached. */
  price: ProductPrice | null
}

/** One row of the Buy credits dialog. */
export interface CreditPackView {
  productId: string
  label: string
  credits: number
  /** Rendered price, or null when the provider has not answered. */
  priceLabel: string | null
  kind: 'first_purchase' | 'topup'
}

const FALLBACK_LABELS: Record<Product['kind'], string> = {
  first_purchase: 'Pro',
  topup: 'Top-up',
}

/**
 * Renders a price from its minor units and the published exponent.
 *
 * Whole amounts drop the decimals ("$3" rather than "$3.00") to match how the
 * pricing is presented, but the exponent is always respected — a currency with
 * no minor unit never grows a decimal part, and one with three keeps all three.
 * Returns null when there is no price to show.
 */
export function formatPrice(price: ProductPrice | null | undefined): string | null {
  if (!price || !Number.isFinite(price.amountMinor)) return null

  const exponent = Number.isFinite(price.minorUnitExponent) ? Math.max(0, price.minorUnitExponent) : 0
  const amount = price.amountMinor / Math.pow(10, exponent)
  const currency =
    typeof price.currency === 'string' && price.currency.trim() ? price.currency.trim().toUpperCase() : ''

  // A whole amount reads better without trailing zeros ("$3"), but a fractional
  // one keeps the currency's full precision ("$4.50", never "$4.5").
  const isWhole = Math.abs(amount - Math.round(amount)) < 1e-9

  let rendered: string
  try {
    rendered = new Intl.NumberFormat(undefined, {
      style: currency ? 'currency' : 'decimal',
      ...(currency ? { currency } : {}),
      minimumFractionDigits: isWhole ? 0 : exponent,
      maximumFractionDigits: exponent,
    }).format(amount)
  } catch {
    // An unknown currency code must not break the dialog.
    rendered = currency ? `${amount} ${currency}` : `${amount}`
  }

  return price.isMinimum ? `from ${rendered}` : rendered
}

/** The dialog's view-model for one product. */
export function toCreditPackView(product: Product): CreditPackView {
  return {
    productId: product.productId,
    label: product.name?.trim() || FALLBACK_LABELS[product.kind] || 'Credits',
    credits: product.credits,
    priceLabel: formatPrice(product.price),
    kind: product.kind,
  }
}

/**
 * The packs to show, cheapest first: the recommendation logic picks the smallest
 * one that covers a shortfall, so the order is part of the contract with it.
 */
export function toCreditPackViews(products: Product[] | null | undefined): CreditPackView[] {
  if (!Array.isArray(products)) return []
  return products
    .filter(
      (product) =>
        product &&
        typeof product.productId === 'string' &&
        product.productId.trim().length > 0 &&
        typeof product.credits === 'number' &&
        product.credits > 0,
    )
    .map(toCreditPackView)
    .sort((a, b) => a.credits - b.credits)
}

/**
 * The product id the "Get Pro" path should buy. The API is the source of truth
 * for which pack starts a licence; returns null when the catalogue is unreachable
 * or carries no entry pack, and the caller shows the user an error instead of
 * guessing an id.
 */
export function firstPurchaseProductId(
  products: Pick<Product, 'kind' | 'productId'>[] | null | undefined,
): string | null {
  const entry = (Array.isArray(products) ? products : []).find(
    (p) => p && p.kind === 'first_purchase' && typeof p.productId === 'string' && p.productId.trim() !== '',
  )
  return entry ? entry.productId : null
}
