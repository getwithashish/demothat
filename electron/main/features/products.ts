// The catalogue: what is for sale, with the server's own product ids and credits.
//
// `GET /v1/products` is public (the website renders its pricing from the same
// endpoint), so this needs no license token and works before activation.

import log from 'electron-log/main'
import type { Product } from '../../../shared/pricing'
import { apiRequest } from '../lib/api-client'
import { getApiBaseUrl } from '../lib/api-config'

const TTL_MS = 60_000
let cache: { value: Product[]; at: number } | null = null

/**
 * The products, cached briefly so opening the dialog twice does not re-fetch.
 * Returns null when the API cannot be reached, which the caller treats as "use
 * the offline fallback" rather than as an error worth shouting about.
 */
export async function fetchProducts(force = false): Promise<Product[] | null> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value
  try {
    const response = await apiRequest<{ products?: Product[] }>(getApiBaseUrl(), {
      method: 'GET',
      path: '/v1/products',
      retries: 1,
    })
    const products = Array.isArray(response?.products) ? response.products : []
    cache = { value: products, at: Date.now() }
    return products
  } catch (error) {
    log.warn(`[Products] Could not load the catalogue: ${(error as Error).message}`)
    return null
  }
}

export function clearProductsCache(): void {
  cache = null
}
