/**
 * features/participant-shell/components/AlertBar/useAlerts.ts
 * ---------------------------------------------------------------------------
 * The alert-bar CONTENT mock seam (feature: participant-shell, story 02;
 * PRT-010/011/012; see docs/features/participant-shell/02-alert-bar-host.md
 * and docs/design/D7-application-shells/SHELL-CONTRACT.md §2).
 *
 * Mirrors `../../shellState.ts` / `../../chromeConfig.ts`'s "mock behind the
 * shared axios client" pattern: every request routes through `api` so the
 * request shape (method, URL, base URL, headers) matches the future
 * `/alerts` endpoint, with mock data swapped at exactly ONE env-guarded flip
 * point (WAVE0-REVIEW precedent 15) rather than per call — a forgotten
 * `adapter:` can't silently fail *open* to mock data in production; a
 * production build without a backend fails closed (the query errors rather
 * than serving a canned value).
 *
 * DIFFERENT safe-default direction from `chromeConfig`/`shellState`: those
 * seams fall back to a VISIBLE, safe-erring default (chrome ON, variant
 * `'full'`) because absence-of-signal there is itself a legitimate steady
 * state. An alert is not — fabricating a plausible "info"/"advisory"/
 * "emergency" alert while a fetch is merely loading/erroring would be
 * actively misleading on the EAS-analog surface (PRT-010). So this seam's
 * fallback — while loading, on error, or absent — is an EMPTY alert list,
 * i.e. the `none` state: fail closed to "no active alert", never to "a
 * plausible one".
 *
 * The Wave-1 mock's canned response is likewise an empty list: an ordinary
 * exercise starts with no injects fired, so `none` (zero-height) is the
 * correct out-of-the-box state a developer sees running `npm run dev`.
 * `AlertBar.tsx`'s other states are exercised via this hook mocked at the
 * module boundary (mirrors `ComplianceChrome.test.tsx` mocking
 * `useChromeConfig`) — swap this constant + `mockAdapter` for a live
 * `/alerts` call (plus a SignalR push) when the backend and the
 * controller-driven publish path (world-steering CTL-020/021, Phase 3) land.
 *
 * Exercise-scoped (XC-001): the React Query key includes the resolved
 * exercise's `exerciseId`, read from `useExerciseContext()` for KEYING only
 * (WAVE0-REVIEW precedent 13) — it is never sent to the server as a
 * client-supplied scoping parameter (the mock ignores it entirely; a real
 * endpoint scopes by the authenticated session, server-side).
 *
 * Uses React Query — this is cacheable shell-content, exactly like
 * `shellState.ts` / `chromeConfig.ts` (contrast `core/exerciseContext`'s
 * deliberately hand-rolled fail-closed gate, WAVE0-REVIEW precedent 16).
 *
 * World: participant. No COBRA, no UI — a pure data hook.
 */

import { useQuery } from '@tanstack/react-query'
import type { AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { useExerciseContext } from '@/core/exerciseContext'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import type { Alert, AlertSeverity } from './alertTypes'

/**
 * All valid alert severities. The runtime guard checks membership here so it
 * matches the wire contract — this seam swaps to a live endpoint with no
 * consumer change, so an out-of-enum `severity` must fail closed (the whole
 * alert is dropped as invalid), not be cast blindly to `AlertSeverity`.
 */
const VALID_ALERT_SEVERITIES: readonly AlertSeverity[] = ['info', 'advisory', 'emergency']

function isAlertSeverity(value: unknown): value is AlertSeverity {
  return typeof value === 'string' && (VALID_ALERT_SEVERITIES as readonly string[]).includes(value)
}

/** `scenarioTime` must be a non-empty, `Date.parse`-able ISO instant string. */
function isScenarioTimeString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

function isAlert(value: unknown): value is Alert {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' && candidate.id.length > 0 &&
    isAlertSeverity(candidate.severity) &&
    typeof candidate.message === 'string' && candidate.message.length > 0 &&
    isScenarioTimeString(candidate.scenarioTime)
  )
}

/** Wire shape of the (future) `/alerts` response body. */
interface AlertsResponseBody {
  readonly alerts: readonly Alert[]
}

/**
 * Runtime guard so this seam swaps to a live endpoint with no consumer
 * change: an out-of-shape response (missing array, or any entry failing
 * {@link isAlert}) must fail closed, not be cast blindly to `Alert[]`.
 */
function isAlertsResponseBody(
  body: AlertsResponseBody | null | undefined,
): body is AlertsResponseBody {
  return !!body && Array.isArray(body.alerts) && body.alerts.every(isAlert)
}

/**
 * The Wave-1 mock's fixed canned response (dev/test only — see
 * `USE_MOCK_ALERTS`): no active alerts. See the module header for why this
 * seam's safe default is EMPTY rather than a fabricated alert.
 */
const MOCK_ALERTS: readonly Alert[] = []

/**
 * Short-circuits the network layer with a canned response so resolution is
 * instant in the current no-backend scaffold, while still exercising the
 * shared axios client's request pipeline (base URL, headers, interceptors)
 * exactly as a live endpoint call would.
 */
const mockAdapter: AxiosAdapter = config => Promise.resolve({
  data: { alerts: MOCK_ALERTS } satisfies AlertsResponseBody,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

/**
 * The SINGLE mock/live flip point (WAVE0-REVIEW precedent 15) — mirrors
 * `shellState.ts`'s `USE_MOCK_SHELL_STATE` / `chromeConfig.ts`'s
 * `USE_MOCK_CHROME_CONFIG`. Mock in dev/test; a production build without a
 * backend fails closed (the query errors rather than serving canned alerts).
 */
const USE_MOCK_ALERTS = USE_MOCK_DATA

async function fetchAlerts(): Promise<readonly Alert[]> {
  const response = await api.get<AlertsResponseBody>(
    '/alerts',
    USE_MOCK_ALERTS ? { adapter: mockAdapter } : undefined,
  )

  if (!isAlertsResponseBody(response.data)) {
    throw new Error(
      'fetchAlerts: mock resolution returned a missing or invalid alerts array',
    )
  }

  return response.data.alerts
}

/**
 * Resolves the current exercise's active alerts.
 *
 * Exercise-scoped via the React Query key (see module header). Falls back to
 * an EMPTY array whenever the query has no resolved data yet — while
 * loading, on error, or absent — so `<AlertBar>` always renders the safe
 * `none` state rather than a fabricated alert.
 */
export function useAlerts(): readonly Alert[] {
  const { exerciseId } = useExerciseContext()

  const { data } = useQuery({
    queryKey: ['participant-shell', 'alert-bar', 'alerts', exerciseId],
    queryFn: fetchAlerts,
  })

  return data ?? []
}
