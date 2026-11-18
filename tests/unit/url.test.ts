import { describe, expect, it } from 'vitest'
import {
  isAllowedNavigationUrl,
  isLoopbackHostname,
  normalizeAddress
} from '../../src/shared/url'

describe('normalizeAddress', () => {
  it('defaults local addresses to HTTP', () => {
    expect(normalizeAddress('localhost:3000')).toEqual({
      ok: true,
      url: 'http://localhost:3000/',
      insecureRemote: false
    })
    expect(normalizeAddress('localhost')).toMatchObject({ ok: true, url: 'http://localhost/' })
    expect(normalizeAddress('127.0.0.1:8080/app')).toMatchObject({
      ok: true,
      url: 'http://127.0.0.1:8080/app'
    })
    expect(normalizeAddress('[::1]:5173')).toMatchObject({ ok: true, url: 'http://[::1]:5173/' })
    expect(normalizeAddress('192.168.1.20:9000')).toMatchObject({
      ok: true,
      url: 'http://192.168.1.20:9000/'
    })
    expect(normalizeAddress('studio.local')).toMatchObject({ ok: true, url: 'http://studio.local/' })
  })

  it('defaults public hostnames to HTTPS', () => {
    expect(normalizeAddress('example.com')).toEqual({
      ok: true,
      url: 'https://example.com/',
      insecureRemote: false
    })
    expect(normalizeAddress('example.com/docs')).toMatchObject({
      ok: true,
      url: 'https://example.com/docs'
    })
  })

  it('treats bare host:port development addresses as HTTP', () => {
    expect(normalizeAddress('dev.example.com:8080')).toMatchObject({
      ok: true,
      url: 'http://dev.example.com:8080/',
      insecureRemote: true
    })
  })

  it('preserves explicit http and https URLs', () => {
    expect(normalizeAddress('https://example.com/path?q=1')).toEqual({
      ok: true,
      url: 'https://example.com/path?q=1',
      insecureRemote: false
    })
    expect(normalizeAddress('http://example.com')).toMatchObject({
      ok: true,
      insecureRemote: true
    })
    expect(normalizeAddress('HTTP://localhost:3000')).toMatchObject({ ok: true, insecureRemote: false })
  })

  it('allows only about:blank from the about scheme', () => {
    expect(normalizeAddress('about:blank')).toEqual({
      ok: true,
      url: 'about:blank',
      insecureRemote: false
    })
    expect(normalizeAddress('about:config')).toMatchObject({ ok: false })
    expect(normalizeAddress('about:srcdoc')).toMatchObject({ ok: false })
  })

  it('rejects dangerous schemes', () => {
    expect(normalizeAddress('javascript:alert(1)')).toMatchObject({ ok: false })
    expect(normalizeAddress('data:text/html,hello')).toMatchObject({ ok: false })
    expect(normalizeAddress('file:///etc/passwd')).toMatchObject({ ok: false })
    expect(normalizeAddress('chrome://settings')).toMatchObject({ ok: false })
  })

  it('rejects empty, malformed, and hostless input', () => {
    expect(normalizeAddress('')).toMatchObject({ ok: false })
    expect(normalizeAddress('   ')).toMatchObject({ ok: false })
    expect(normalizeAddress('http://')).toMatchObject({ ok: false })
    expect(normalizeAddress('https://?q=1')).toMatchObject({ ok: false })
  })
})

describe('isAllowedNavigationUrl', () => {
  it('allows http, https, and about:blank', () => {
    expect(isAllowedNavigationUrl('http://localhost:3000')).toBe(true)
    expect(isAllowedNavigationUrl('https://example.com/path')).toBe(true)
    expect(isAllowedNavigationUrl('about:blank')).toBe(true)
  })

  it('rejects unsupported or malformed URLs', () => {
    expect(isAllowedNavigationUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedNavigationUrl('file:///tmp/page.html')).toBe(false)
    expect(isAllowedNavigationUrl('about:config')).toBe(false)
    expect(isAllowedNavigationUrl('not a url')).toBe(false)
  })
})

describe('isLoopbackHostname', () => {
  it('accepts localhost and IPv4/IPv6 loopback forms', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('LOCALHOST')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('127.12.34.56')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('::1')).toBe(true)
  })

  it('rejects public hostnames and non-loopback addresses', () => {
    expect(isLoopbackHostname('example.com')).toBe(false)
    expect(isLoopbackHostname('localhost.example.com')).toBe(false)
    expect(isLoopbackHostname('192.168.1.10')).toBe(false)
    expect(isLoopbackHostname('127.0.0.999')).toBe(false)
  })
})
