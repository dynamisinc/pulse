/**
 * features/login/staticWebAppConfig.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login story 08, AC2: `public/staticwebapp.config.json` sends
 * `Referrer-Policy: no-referrer` and `Cache-Control: no-store` for `/join/*`
 * (decision EL-7: the join link's token is in the path of that one request, so the
 * document must not be cached and must not be sent on as a `Referer`), and the
 * existing `navigationFallback` is preserved (the SPA still serves `index.html` for
 * every deep link, and still lets real assets through).
 *
 * Reads the REAL config off disk (`readFrontendFile`) and checks its shape; it does
 * not re-implement Azure Static Web Apps' matcher beyond the one wildcard it needs
 * to prove `/join/<token>` is covered.
 */
import { describe, expect, it } from 'vitest'
import { readFrontendFile } from '@/test/readSource'

interface RouteRule {
  readonly route: string
  readonly headers?: Record<string, string>
  readonly allowedRoles?: readonly string[]
  readonly rewrite?: string
  readonly redirect?: string
}

interface StaticWebAppConfig {
  readonly routes?: readonly RouteRule[]
  readonly navigationFallback?: {
    readonly rewrite?: string
    readonly exclude?: readonly string[]
  }
}

const CONFIG = JSON.parse(readFrontendFile('public/staticwebapp.config.json')) as StaticWebAppConfig

const JOIN_RULES = (CONFIG.routes ?? []).filter(rule => rule.route === '/join/*')

/** SWA's trailing-wildcard route syntax: `/join/*` covers everything under `/join/`. */
function covers(route: string, path: string): boolean {
  return route.endsWith('/*') && path.startsWith(route.slice(0, -1))
}

describe('public/staticwebapp.config.json — the /join/* route override (EL-7)', () => {
  it('has exactly one rule for /join/*', () => {
    expect(JOIN_RULES).toHaveLength(1)
  })

  it('sends Referrer-Policy: no-referrer', () => {
    expect(JOIN_RULES[0]?.headers?.['Referrer-Policy']).toBe('no-referrer')
  })

  it('sends Cache-Control: no-store', () => {
    expect(JOIN_RULES[0]?.headers?.['Cache-Control']).toBe('no-store')
  })

  it('covers a personal-link path', () => {
    expect(covers(JOIN_RULES[0]?.route ?? '', '/join/tok_7f3a9c1e-abc')).toBe(true)
  })

  it('is anonymous: no role is required to open a personal link', () => {
    expect(JOIN_RULES[0]?.allowedRoles).toBeUndefined()
  })

  it('only adds headers: it neither redirects nor rewrites the request', () => {
    expect(JOIN_RULES[0]?.redirect).toBeUndefined()
    expect(JOIN_RULES[0]?.rewrite).toBeUndefined()
  })
})

describe('public/staticwebapp.config.json — the existing navigationFallback is preserved', () => {
  it('still rewrites unknown paths to /index.html', () => {
    expect(CONFIG.navigationFallback?.rewrite).toBe('/index.html')
  })

  it('still excludes the build assets and static file types', () => {
    expect(CONFIG.navigationFallback?.exclude).toEqual([
      '/assets/*',
      '/*.{css,js,png,jpg,jpeg,gif,svg,ico,woff,woff2,webmanifest}',
    ])
  })

  it('does not exclude /join/*, so a personal link still gets the SPA shell', () => {
    const excluded = CONFIG.navigationFallback?.exclude ?? []

    expect(excluded.some(pattern => covers(pattern, '/join/tok_x'))).toBe(false)
  })
})
