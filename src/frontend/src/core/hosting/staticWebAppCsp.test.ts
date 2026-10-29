/**
 * core/hosting/staticWebAppCsp.test.ts
 * ---------------------------------------------------------------------------
 * Channels-foundation story 23 (PP-3, #789): the Content-Security-Policy the SPA host
 * sends, from `public/staticwebapp.config.json` `globalHeaders` (Azure Static Web Apps
 * adds them to every response, `navigationFallback` documents included).
 *
 * Two headers: an ENFORCED `Content-Security-Policy` (`font-src 'self'` plus two
 * directives nothing in the app can trip) and a REPORT-ONLY full baseline that soaks on
 * UAT before it is promoted. Both are pinned in full, so any later loosening fails here.
 * The mode, the relaxations and their reasons are in the story's "Implementation notes".
 */
import { describe, expect, it } from 'vitest'
import { readFrontendFile } from '@/test/readSource'

interface StaticWebAppConfig {
  readonly globalHeaders?: Record<string, string>
  readonly routes?: readonly { readonly route: string, readonly headers?: Record<string, string> }[]
  readonly navigationFallback?: { readonly exclude?: readonly string[] }
}

const CONFIG = JSON.parse(readFrontendFile('public/staticwebapp.config.json')) as StaticWebAppConfig
const HEADERS = CONFIG.globalHeaders ?? {}

const ENFORCED = 'Content-Security-Policy'
const REPORT_ONLY = 'Content-Security-Policy-Report-Only'

const EXPECTED_ENFORCED = "font-src 'self'; object-src 'none'; base-uri 'self'"

const EXPECTED_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' https: data: blob:",
  "media-src 'self' https: blob:",
  "connect-src 'self' https: wss:",
  "manifest-src 'self' blob:",
  "worker-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

/** `directive -> sources` for a policy string. */
function parsePolicy(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(';')
      .map(part => part.trim().split(/\s+/))
      .flatMap(([name, ...sources]) => (name ? [[name.toLowerCase(), sources] as const] : [])),
  )
}

const POLICIES = [
  [ENFORCED, HEADERS[ENFORCED] ?? ''],
  [REPORT_ONLY, HEADERS[REPORT_ONLY] ?? ''],
] as const

describe('staticwebapp.config.json — the CSP headers are pinned in full (story 23 AC2)', () => {
  it('enforces exactly the font baseline', () => {
    expect(HEADERS[ENFORCED]).toBe(EXPECTED_ENFORCED)
  })

  it('reports exactly the full baseline', () => {
    expect(HEADERS[REPORT_ONLY]).toBe(EXPECTED_REPORT_ONLY)
  })

  it('sends no other CSP header', () => {
    const cspHeaders = Object.keys(HEADERS).filter(name => /content-security-policy/i.test(name))

    expect(cspHeaders.sort()).toEqual([ENFORCED, REPORT_ONLY])
  })
})

describe.each(POLICIES)('the %s header', (name, policy) => {
  const directives = parsePolicy(policy)

  it("allows fonts from 'self' only (AC1)", () => {
    expect(directives.get('font-src')).toEqual(["'self'"])
  })

  it('names no third-party font origin or CDN (AC1)', () => {
    expect(policy).not.toMatch(/fonts\.googleapis|fonts\.gstatic|cdn|typekit|jsdelivr|unpkg/i)
  })

  it('hard-codes no absolute host, so it holds on the apex and every subdomain (AC4, COR-008)', () => {
    const sources = Array.from(directives.values()).flat()
    // Keywords ('self', 'none', ...) and bare schemes (https:, blob:) only.
    const isKeywordOrScheme = (source: string) =>
      /^'[a-z-]+'$/.test(source) || /^[a-z]+:$/.test(source)
    const hostSources = sources.filter(source => !isKeywordOrScheme(source))

    expect(hostSources).toEqual([])
    expect(policy).not.toContain('*')
  })

  it('lists each directive once (the browser ignores a repeat)', () => {
    const names = policy.split(';').map(part => part.trim().split(/\s+/)[0])

    expect(new Set(names).size).toBe(names.length)
  })

  it('never allows eval', () => {
    expect(policy).not.toContain("'unsafe-eval'")
  })

  it("restricts script to 'self' (report-only) or leaves it to the baseline (enforced)", () => {
    // The enforced header deliberately names no script-src/default-src yet: it governs
    // fonts only until the report-only baseline is promoted.
    const expected = name === ENFORCED ? undefined : ["'self'"]

    expect(directives.get('script-src')).toEqual(expected)
    expect(directives.get('default-src')).toEqual(expected)
  })

  it("uses 'unsafe-inline' only in style-src (emotion) (AC2)", () => {
    const unsafe = Array.from(directives.entries())
      .filter(([, sources]) => sources.some(source => source.startsWith("'unsafe-")))
      .map(([directive, sources]) => `${directive} ${sources.filter(s => s.startsWith("'unsafe-")).join(' ')}`)

    expect(unsafe).toEqual(name === ENFORCED ? [] : ["style-src 'unsafe-inline'"])
  })
})

describe('staticwebapp.config.json — the CSP reaches every document', () => {
  it('comes from globalHeaders only: no route rule sets or overrides a CSP header', () => {
    for (const rule of CONFIG.routes ?? []) {
      const names = Object.keys(rule.headers ?? {})

      expect(names.filter(name => /content-security-policy/i.test(name))).toEqual([])
    }
  })

  it('serves woff2 fonts as files, not through the SPA fallback (AC3)', () => {
    expect(CONFIG.navigationFallback?.exclude).toContain(
      '/*.{css,js,png,jpg,jpeg,gif,svg,ico,woff,woff2,webmanifest}',
    )
    expect(CONFIG.navigationFallback?.exclude).toContain('/assets/*')
  })
})
