/**
 * features/participant-shell/brandTokens.ts
 * ---------------------------------------------------------------------------
 * The per-exercise brand-token mock seam (feature: participant-shell, story
 * 07; COR-066/030; see
 * docs/features/participant-shell/07-brand-theming-hooks.md and
 * docs/design/D7-application-shells/SHELL-CONTRACT.md §1 "Theming hooks").
 *
 * Mirrors `chromeConfig.ts` / `shellState.ts`'s "mock behind the shared axios
 * client" pattern: every request routes through `api` so the request shape
 * (method, URL, base URL, headers) matches the future `/brand-tokens`
 * endpoint, with mock data swapped at exactly ONE env-guarded flip point
 * (WAVE0-REVIEW precedent 15) rather than per call — a production build
 * without a backend fails CLOSED (the query errors; `useBrandConfig()` never
 * invents a brand beyond the documented, screened-default fallback below).
 *
 * This module owns the brand-token TYPES (`BrandColors` / `BrandLogo` /
 * `BrandTokens`). They are deliberately NOT part of `mountContract.ts`'s
 * shell-state envelope: per SHELL-CONTRACT.md §1's "Theming hooks" row, brand
 * tokens are a separate, channel-facing concern, kept fully independent of the
 * shell's own chrome/alert-bar/overlay palettes — the exercise signal (the
 * compliance chrome) never re-skins to match the fiction (XC-002/003), and
 * this module's tokens never feed `chromeConfig.ts` / an alert palette / the
 * overlay treatments, nor do they read from them.
 *
 * The default tokens below are DEMO CONFIG, not product copy — same status as
 * the mockup's "Fairhaven" / "BAY SHIELD" strings (D7 fidelity note). They are
 * deliberately neutral (no invented in-fiction brand identity) and are
 * screened to meet WCAG AA contrast (`onSurface` `#1c1c1c` on `surface`
 * `#ffffff` computes to ~17:1 by the WCAG relative-luminance formula — well
 * over the 4.5:1 normal-text threshold) so a channel rendering against the
 * unconfigured default is never handed an inaccessible skin.
 *
 * Exercise-scoped (XC-001): the React Query key includes the resolved
 * exercise's `exerciseId`, read from `useExerciseContext()` for KEYING only
 * (WAVE0-REVIEW precedent 13) — it is never sent to the server as a
 * client-supplied scoping parameter (the mock ignores it entirely; a real
 * endpoint scopes by the authenticated session, server-side). Switching
 * exercises switches the query key, so a session can never keep serving a
 * stale/other exercise's cached brand.
 *
 * Uses React Query — this is cacheable shell config, exactly like
 * `chromeConfig.ts` / `shellState.ts` (contrast `core/exerciseContext`'s
 * deliberately hand-rolled fail-closed gate, WAVE0-REVIEW precedent 16).
 *
 * World: participant. No COBRA, no UI — a pure data hook. The shell hardcodes
 * NO brand name, color, or logo anywhere beyond this one screened, neutral
 * fallback constant, which itself is config data, not a fixed brand.
 *
 * Also colocates the brand-tokens REACT CONTEXT (`BrandTokensContext`) and its
 * fail-closed consumer hooks (`useBrandTokens()` / `useBrand()`), plus the
 * `--pulse-brand-*` CSS custom-property NAMES `BrandThemeProvider.tsx`
 * publishes. This mirrors `mountContract.ts`'s precedent of colocating a
 * context + hook in a plain `.ts` module (no JSX needed to create a context or
 * call `useContext`) — kept here rather than in `BrandThemeProvider.tsx` so
 * that component-only file exports exactly one thing, the provider component
 * (`react-refresh/only-export-components`); the JSX `<Context.Provider>`
 * itself still lives in `BrandThemeProvider.tsx`, the only place in this
 * story's surface that needs JSX.
 */

import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { useExerciseContext } from '@/core/exerciseContext'
import { USE_MOCK_DATA } from '@/core/config/mockData'

/**
 * The minimal, channel-useful color set a brand skin themes against. Kept
 * deliberately small (the story's technical notes) — not a full design
 * system, just enough for a channel to derive its own skin.
 */
export interface BrandColors {
  readonly primary: string
  readonly accent: string
  readonly surface: string
  readonly onSurface: string
}

/** Optional brand logo slot — a channel renders it, or falls back to text. */
export interface BrandLogo {
  readonly src: string
  readonly alt: string
}

/** The per-exercise brand tokens a channel themes against (COR-066/030). */
export interface BrandTokens {
  readonly name: string
  readonly colors: BrandColors
  readonly logo?: BrandLogo
}

/** Wire shape of the (future) `/brand-tokens` response body. */
type BrandTokensResponseBody = BrandTokens

/**
 * The screened, neutral DEMO CONFIG default (not product copy — see module
 * header). Deliberately generic: no invented brand identity beyond "a
 * placeholder name channels can theme against". Colors are screened to meet
 * WCAG AA contrast for `onSurface` on `surface`, so an unconfigured channel
 * never ships an inaccessible default skin.
 */
const DEFAULT_BRAND_TOKENS: BrandTokens = {
  name: 'Sample Exercise Network',
  colors: {
    primary: '#2b5f75',
    accent: '#d97706',
    surface: '#ffffff',
    onSurface: '#1c1c1c',
  },
}

function isBrandColors(value: unknown): value is BrandColors {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.primary === 'string' &&
    typeof candidate.accent === 'string' &&
    typeof candidate.surface === 'string' &&
    typeof candidate.onSurface === 'string'
  )
}

function isBrandLogo(value: unknown): value is BrandLogo {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.src === 'string' && typeof candidate.alt === 'string'
}

/**
 * Runtime guard so this seam swaps to a live endpoint with no consumer
 * change: an out-of-shape response must fail closed, not be cast blindly to
 * `BrandTokens`. `logo` is optional — absent is valid; present-but-malformed
 * is not.
 */
function isBrandTokens(value: unknown): value is BrandTokens {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.name !== 'string' || candidate.name.length === 0) return false
  if (!isBrandColors(candidate.colors)) return false
  if (candidate.logo !== undefined && !isBrandLogo(candidate.logo)) return false
  return true
}

/**
 * Short-circuits the network layer with a canned response so resolution is
 * instant in the current no-backend scaffold, while still exercising the
 * shared axios client's request pipeline (base URL, headers, interceptors)
 * exactly as a live endpoint call would.
 */
const mockAdapter: AxiosAdapter = config => Promise.resolve({
  data: DEFAULT_BRAND_TOKENS,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

/**
 * The SINGLE mock/live flip point (WAVE0-REVIEW precedent 15) — mirrors
 * `chromeConfig.ts`'s `USE_MOCK_CHROME_CONFIG`. Mock in dev/test; a
 * production build without a backend fails closed (the query errors rather
 * than serving a canned brand).
 */
const USE_MOCK_BRAND_TOKENS = USE_MOCK_DATA

async function fetchBrandTokens(): Promise<BrandTokens> {
  const response = await api.get<BrandTokensResponseBody>(
    '/brand-tokens',
    USE_MOCK_BRAND_TOKENS ? { adapter: mockAdapter } : undefined,
  )

  if (!isBrandTokens(response.data)) {
    throw new Error(
      'fetchBrandTokens: mock resolution returned a missing or invalid BrandTokens',
    )
  }

  return response.data
}

/**
 * Resolves the current exercise's brand tokens.
 *
 * Exercise-scoped via the React Query key (see module header). Falls back to
 * the screened `DEFAULT_BRAND_TOKENS` whenever the query has no resolved data
 * yet — while loading, on error, or absent — so a channel always themes
 * against a complete, contrast-screened token set; it never renders against a
 * partial/undefined brand.
 */
export function useBrandConfig(): BrandTokens {
  const { exerciseId } = useExerciseContext()

  const { data } = useQuery({
    queryKey: ['participant-shell', 'brand-tokens', exerciseId],
    queryFn: fetchBrandTokens,
  })

  return data ?? DEFAULT_BRAND_TOKENS
}

// -----------------------------------------------------------------------------
// Brand-tokens context + consumer hooks (see module header). Internal to this
// story's surface — `BrandThemeProvider.tsx` is the only intended importer of
// `BrandTokensContext`; channels call `useBrandTokens()` / `useBrand()`, never
// the raw context.
// -----------------------------------------------------------------------------

const BrandTokensContext = createContext<BrandTokens | undefined>(undefined)

export { BrandTokensContext }

/**
 * Returns the current channel's resolved brand tokens.
 *
 * Fail-closed: throws when called outside a `<BrandThemeProvider>` rather
 * than returning a default brand a channel could silently render against
 * (matches the `useShellContext()` / `useExerciseContext()` precedent).
 */
export function useBrandTokens(): BrandTokens {
  const tokens = useContext(BrandTokensContext)
  if (tokens === undefined) {
    throw new Error(
      'useBrandTokens() must be called within a <BrandThemeProvider>. ' +
      'There is no default brand a channel can render against outside one.',
    )
  }
  return tokens
}

/**
 * Alias for {@link useBrandTokens}. The story names both `useBrand()` and
 * `useBrandTokens()` as the channel-facing consumer hook; both are exported so
 * either reads naturally at a call site (`useBrand().colors.primary` vs.
 * `useBrandTokens().colors.primary`).
 */
export function useBrand(): BrandTokens {
  return useBrandTokens()
}

/**
 * CSS custom-property NAMES `BrandThemeProvider` publishes, SCOPED to its own
 * wrapper element (never `:root` — see `BrandThemeProvider.tsx`'s module
 * header for why this departs from `ComplianceChrome`'s `:root` publication).
 * A channel MAY read these directly (e.g.
 * `style={{ color: 'var(--pulse-brand-primary)' }}`) instead of calling
 * `useBrandTokens()` — both read the same exercise-scoped brand config.
 */
export const BRAND_PRIMARY_VAR = '--pulse-brand-primary'
export const BRAND_ACCENT_VAR = '--pulse-brand-accent'
export const BRAND_SURFACE_VAR = '--pulse-brand-surface'
export const BRAND_ON_SURFACE_VAR = '--pulse-brand-on-surface'
