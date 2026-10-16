// Thin JSON client for demothat-api.
//
// All network code lives in the main process. This module is provider-free
// (plain node:http / node:https), retries only when a retry can plausibly help
// (network failures and 5xx), and normalises the contract's error envelope
// `{ error: { code, message, details } }` into an `ApiError`.

import http from 'node:http'
import https from 'node:https'
import log from 'electron-log/main'

/** An error carrying the API's own code, so callers can branch on it. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ApiRequestOptions {
  method: 'GET' | 'POST' | 'DELETE'
  /** Path including any query string, e.g. `/v1/purchases/abc`. */
  path: string
  body?: unknown
  /** Bearer token (license token). Omitted for the unauthenticated endpoints. */
  token?: string | null
  /** Extra headers, e.g. `X-Poll-Token`. */
  headers?: Record<string, string>
  /** Attempts = retries + 1. Default 3 retries. */
  retries?: number
}

const RETRY_DELAYS_MS = [400, 1200, 3000]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function transportFor(url: URL) {
  return url.protocol === 'https:' ? https : http
}

function isRetryable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code
  if (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND'
  ) {
    return true
  }
  const status = (error as ApiError)?.status
  return typeof status === 'number' && status >= 500
}

function parseErrorBody(body: string, status: number): { code: string; message: string; details?: unknown } {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string; message?: string; details?: unknown } }
    return {
      code: parsed.error?.code ?? `http_${status}`,
      message: parsed.error?.message ?? `The server returned HTTP ${status}`,
      details: parsed.error?.details,
    }
  } catch {
    return { code: `http_${status}`, message: `The server returned HTTP ${status}` }
  }
}

/**
 * Performs one JSON request against `baseUrl`, retrying transient failures.
 * Rejects with an `ApiError` for every non-2xx response and for network errors
 * once the retries are exhausted.
 */
export async function apiRequest<T>(baseUrl: string, options: ApiRequestOptions): Promise<T> {
  const url = new URL(options.path, `${baseUrl.replace(/\/+$/, '')}/`)
  const payload = options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body))
  const attempts = (options.retries ?? RETRY_DELAYS_MS.length) + 1

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = transportFor(url).request(
          {
            method: options.method,
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            headers: {
              Accept: 'application/json',
              ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
              ...(options.headers ?? {}),
              ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
            },
          },
          (response) => {
            const chunks: Buffer[] = []
            response.on('data', (chunk) => chunks.push(chunk as Buffer))
            response.on('end', () => {
              const text = Buffer.concat(chunks).toString()
              const status = response.statusCode ?? 0
              if (status >= 200 && status < 300) {
                try {
                  resolve((text ? JSON.parse(text) : {}) as T)
                } catch (error) {
                  reject(new ApiError(`Malformed response: ${String(error)}`, 'bad_response', status))
                }
                return
              }
              const { code, message, details } = parseErrorBody(text, status)
              reject(new ApiError(message, code, status, details))
            })
            response.on('error', reject)
          },
        )
        request.on('error', reject)
        if (payload) request.write(payload)
        request.end()
      })
    } catch (error) {
      const isLast = attempt === attempts - 1
      if (isLast || !isRetryable(error)) throw error
      const delay = RETRY_DELAYS_MS[attempt] ?? 3000
      log.warn(
        `[ApiClient] ${options.method} ${options.path} failed (${(error as Error).message}); retry in ${delay}ms`,
      )
      await sleep(delay)
    }
  }
  throw new ApiError('Unreachable', 'unreachable')
}
