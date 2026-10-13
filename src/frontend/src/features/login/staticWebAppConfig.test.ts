/**
 * features/login/staticWebAppConfig.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login story 08, AC2: `public/staticwebapp.config.json` sends
 * `Referrer-Policy: no-referrer` and `Cache-Control: no-store` for the join routes
 * (decision EL-7: the join link's token is in the path of that one request, so the
 * document must not be cached and must not be sent on as a `Referer`), and the
 * existing `navigationFallback` is preserved (the SPA still serves `index.html` for
 * every deep link, and still lets real assets through).
 *
 * WHY EACH ROUTE RULE CARRIES ITS OWN `rewrite`. `/join/<token>` is not a file, so
 * Azure Static Web Apps serves it through `navigationFallback`. Microsoft Learn,
 * "Configure Azure Static Web Apps" (section "Fallback routes"), says:
 *
 *     "Route rules aren't applied on requests that trigger `navigationFallback`."
 *
 * A rule that only listed `headers` would therefore be silently ignored for the one
 * URL it exists for. A rule with `"rewrite": "/index.html"` is matched as a ROUTE
 * (it is not a fallback request), serves the SPA shell itself, and so its headers
 * are applied. JSON has no comments, which is why the reason lives here. There are
 * two rules because `/join/*` does not cover the bare `/join` (the scrubbed address
 * after a reload), and that page should carry the same headers.
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

/** The two join rules: the wildcard (a personal link) and the bare path (after a scrub). */
const JOIN_ROUTES = ['/join/*', '/join'] as const

function ruleFor(route: string): RouteRule | undefined {
  return (CONFIG.routes ?? []).find(rule => rule.route === route)
}

/** SWA's trailing-wildcard route syntax: `/join/*` covers everything under `/join/`. */
function covers(route: string, path: string): boolean {
  return route.endsWith('/*') ? path.startsWith(route.slice(0, -1)) : route === path
}

describe.each(JOIN_ROUTES)('public/staticwebapp.config.json — the %s route (EL-7)', route => {
  it('has exactly one rule for the route', () => {
    expect((CONFIG.routes ?? []).filter(rule => rule.route === route)).toHaveLength(1)
  })

  it('sends Referrer-Policy: no-referrer', () => {
    expect(ruleFor(route)?.headers?.['Referrer-Policy']).toBe('no-referrer')
  })

  it('sends Cache-Control: no-store', () => {
    expect(ruleFor(route)?.headers?.['Cache-Control']).toBe('no-store')
  })

  it('serves the SPA shell itself (rewrite): route rules are not applied to fallback requests', () => {
    expect(ruleFor(route)?.rewrite).toBe('/index.html')
  })

  it('rewrites to the same page the navigationFallback serves', () => {
    expect(ruleFor(route)?.rewrite).toBe(CONFIG.navigationFallback?.rewrite)
  })

  it('is anonymous: no role is required to open a personal link', () => {
    expect(ruleFor(route)?.allowedRoles).toBeUndefined()
  })

  it('does not redirect', () => {
    expect(ruleFor(route)?.redirect).toBeUndefined()
  })
})

describe('public/staticwebapp.config.json — what the join rules cover', () => {
  it('covers a personal-link path with the wildcard rule', () => {
    expect(covers('/join/*', '/join/tok_7f3a9c1e-abc')).toBe(true)
  })

  it('covers the scrubbed address with the bare rule (the wildcard does not)', () => {
    expect(covers('/join', '/join')).toBe(true)
    expect(covers('/join/*', '/join')).toBe(false)
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
