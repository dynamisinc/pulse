/**
 * features/participant-shell/chromeConfig.ts
 * ---------------------------------------------------------------------------
 * The compliance-chrome CONFIG mock seam (feature: participant-shell, story
 * 01; COR-031, COR-030/066, NFR-008; see
 * docs/features/participant-shell/01-compliance-chrome.md and
 * docs/design/D7-application-shells/SHELL-CONTRACT.md §1 "Compliance chrome").
 *
 * Mirrors `shellState.ts`'s "mock behind the shared axios client" pattern:
 * every request routes through `api` so the request shape (method, URL, base
 * URL, headers) matches the future `/chrome-config` endpoint, with mock data
 * swapped at exactly ONE env-guarded flip point (WAVE0-REVIEW precedent 15)
 * rather than per call — a production build without a backend fails CLOSED
 * (the query errors; `useChromeConfig` never invents a config beyond the
 * documented, safe-default fallback below).
 *
 * This story owns the CONTENT of `ChromeConfig` — `mountContract.ts` (story
 * 04) owns only the TYPE. The default top/bottom banner strings and colors
 * below are CONFIG VALUES read by `ComplianceChrome.tsx`, never constants
 * embedded in that component (AC2: "zero brand/classification strings are
 * hardcoded in shell code").
 *
 * `enabled` is config too — chrome-off is a legal per-exercise state
 * (D7-008/AC3). `isWatermarkRequired()` derives the NFR-008 invariant ("chrome
 * and watermark are never both off") from whatever config resolves; it does
 * NOT render a watermark itself — that is a participant-channel concern,
 * explicitly out of scope for this story.
 *
 * Exercise-scoped (XC-001): the React Query key includes the resolved
 * exercise's `exerciseId`, read from `useExerciseContext()` for KEYING only
 * (WAVE0-REVIEW precedent 13) — it is never sent to the server as a
 * client-supplied scoping parameter (the mock ignores it entirely; a real
 * endpoint scopes by the authenticated session, server-side).
 *
 * Uses React Query — this is cacheable shell config, exactly like
 * `shellState.ts` (contrast `core/exerciseContext`'s deliberately hand-rolled
 * fail-closed gate, WAVE0-REVIEW precedent 16).
 *
 * World: participant. No COBRA, no UI — a pure data hook.
 */

import { useQuery } from '@tanstack/react-query'
import type { AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { useExerciseContext } from '@/core/exerciseContext'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import type { ChromeBannerConfig, ChromeConfig } from './mountContract'

/** Wire shape of the (future) `/chrome-config` response body. */
type ChromeConfigResponseBody = ChromeConfig

/**
 * The AC-canonical default banner copy (story 01's Acceptance Criteria). This
 * is the ONLY place these strings are declared — `ComplianceChrome.tsx` never
 * embeds them; it renders whatever `useChromeConfig()` resolves.
 */
const DEFAULT_TOP_TEXT =
  'UNCLASSIFIED // EXERCISE · EXERCISE · EXERCISE — ALL CONTENT SIMULATED'
const DEFAULT_BOTTOM_TEXT =
  'PULSE TRAINING ENVIRONMENT — SIMULATED INFORMATION SPACE — NOT REAL NEWS'

/** The mockup's canonical banner colors (green on light green — D7-005). */
const DEFAULT_BANNER_FG = '#eaf5e6'
const DEFAULT_BANNER_BG = '#2e6b2e'

/**
 * The AC-canonical resolved config: chrome on, default strings/colors. Used
 * both as this Wave-1 mock's fixed response AND as the safe-default fallback
 * `useChromeConfig()` returns while the query has no resolved data yet
 * (loading/error) — a participant channel always renders against a fully
 * config-shaped value, and the default errs toward the classification
 * banners being VISIBLE rather than silently absent.
 */
const DEFAULT_CHROME_CONFIG: ChromeConfig = {
  enabled: true,
  top: {
    text: DEFAULT_TOP_TEXT,
    fg: DEFAULT_BANNER_FG,
    bg: DEFAULT_BANNER_BG,
  },
  bottom: {
    text: DEFAULT_BOTTOM_TEXT,
    fg: DEFAULT_BANNER_FG,
    bg: DEFAULT_BANNER_BG,
  },
}

function isChromeBannerConfig(value: unknown): value is ChromeBannerConfig {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.text === 'string' &&
    typeof candidate.fg === 'string' &&
    typeof candidate.bg === 'string'
  )
}

/**
 * Runtime guard so this seam swaps to a live endpoint with no consumer
 * change: an out-of-shape response must fail closed, not be cast blindly to
 * `ChromeConfig`.
 */
function isChromeConfig(value: unknown): value is ChromeConfig {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.enabled === 'boolean' &&
    isChromeBannerConfig(candidate.top) &&
    isChromeBannerConfig(candidate.bottom)
  )
}

/**
 * Short-circuits the network layer with a canned response so resolution is
 * instant in the current no-backend scaffold, while still exercising the
 * shared axios client's request pipeline (base URL, headers, interceptors)
 * exactly as a live endpoint call would.
 */
const mockAdapter: AxiosAdapter = config => Promise.resolve({
  data: DEFAULT_CHROME_CONFIG,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

/**
 * The SINGLE mock/live flip point (WAVE0-REVIEW precedent 15) — mirrors
 * `shellState.ts`'s `USE_MOCK_SHELL_STATE`. Mock in dev/test; a production
 * build without a backend fails closed (the query errors rather than
 * serving a canned config).
 */
const USE_MOCK_CHROME_CONFIG = USE_MOCK_DATA

async function fetchChromeConfig(): Promise<ChromeConfig> {
  const response = await api.get<ChromeConfigResponseBody>(
    '/chrome-config',
    USE_MOCK_CHROME_CONFIG ? { adapter: mockAdapter } : undefined,
  )

  if (!isChromeConfig(response.data)) {
    throw new Error(
      'fetchChromeConfig: mock resolution returned a missing or invalid ChromeConfig',
    )
  }

  return response.data
}

/**
 * Resolves the current exercise's compliance-chrome config.
 *
 * Exercise-scoped via the React Query key (see module header). Falls back to
 * `DEFAULT_CHROME_CONFIG` whenever the query has no resolved data yet — while
 * loading, on error, or absent — so `ComplianceChrome` always has a complete
 * config to render against; it never renders against a partial/undefined
 * value.
 */
export function useChromeConfig(): ChromeConfig {
  const { exerciseId } = useExerciseContext()

  const { data } = useQuery({
    queryKey: ['participant-shell', 'chrome-config', exerciseId],
    queryFn: fetchChromeConfig,
  })

  return data ?? DEFAULT_CHROME_CONFIG
}

/**
 * The NFR-008 invariant: chrome and the in-content "EXERCISE" watermark are
 * never BOTH off. When compliance chrome is disabled (a legal state, AC3),
 * the watermark becomes the required fallback signal. This module only
 * exposes the signal — rendering the watermark is a participant-channel
 * concern, out of scope here.
 */
export const isWatermarkRequired = (config: ChromeConfig): boolean => !config.enabled
