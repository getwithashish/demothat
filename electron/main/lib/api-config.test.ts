import { afterEach, describe, expect, it } from 'vitest'
import { CHECKOUT_HOST_ALLOWLIST, DEFAULT_API_BASE_URL, getApiBaseUrl, isAllowedCheckoutUrl } from './api-config'

describe('getApiBaseUrl', () => {
  afterEach(() => {
    delete process.env.DEMOTHAT_API_BASE_URL
  })

  it('defaults to the production host', () => {
    expect(getApiBaseUrl()).toBe(DEFAULT_API_BASE_URL)
  })

  it('honours the environment override and strips trailing slashes', () => {
    process.env.DEMOTHAT_API_BASE_URL = 'http://localhost:8787///'
    expect(getApiBaseUrl()).toBe('http://localhost:8787')
  })

  it('ignores a blank override', () => {
    process.env.DEMOTHAT_API_BASE_URL = '   '
    expect(getApiBaseUrl()).toBe(DEFAULT_API_BASE_URL)
  })
})

describe('isAllowedCheckoutUrl', () => {
  it('accepts every allow-listed host over https', () => {
    for (const host of CHECKOUT_HOST_ALLOWLIST) {
      expect(isAllowedCheckoutUrl(`https://${host}/checkout/session?id=1`)).toBe(true)
    }
  })

  it('refuses http, even on an allow-listed host', () => {
    expect(isAllowedCheckoutUrl(`http://${CHECKOUT_HOST_ALLOWLIST[0]}/pay`)).toBe(false)
  })

  it('refuses any other host', () => {
    expect(isAllowedCheckoutUrl('https://evil.example.com/pay')).toBe(false)
    // A lookalike suffix must not pass: the host has to match exactly.
    expect(isAllowedCheckoutUrl(`https://${CHECKOUT_HOST_ALLOWLIST[0]}.evil.com/pay`)).toBe(false)
  })

  it('refuses non-http schemes and junk', () => {
    expect(isAllowedCheckoutUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedCheckoutUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedCheckoutUrl('not a url')).toBe(false)
    expect(isAllowedCheckoutUrl('')).toBe(false)
    expect(isAllowedCheckoutUrl(null)).toBe(false)
    expect(isAllowedCheckoutUrl(42)).toBe(false)
  })
})
