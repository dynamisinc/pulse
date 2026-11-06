/**
 * features/participant-shell/components/AlertBar/alertsSource.ts
 * ---------------------------------------------------------------------------
 * The alert bar's DATA SOURCE: the runtime guards, the canned mock, the two
 * reads (`GET /alerts`, `GET /alerts/history`) and their React Query keys
 * (participant-shell story 02; channels-foundation story 11, #707; PRT-010/
 * 011/012, FC-4/FC-5). `useAlerts()` and `useAlertsHistory()` are the hooks
 * over it.
 *
 * FAIL CLOSED. Every body is checked before use: an out-of-shape response —
 * a missing array, or ANY entry failing {@link isAlert} — throws, so the query
 * errors and the hooks fall back to an EMPTY list (the bar's `none` state),
 * never a partially filtered or fabricated one. `AlertsChanged` push frames
 * pass the SAME guard ({@link isAlertsBody}). Fabricating an alert on the
 * EAS-analog surface would be actively misleading (PRT-010).
 *
 * ONE MOCK FLIP POINT (WAVE0-REVIEW precedent 15). With `USE_MOCK_DATA` on, both
 * reads go through the shared axios client with {@link alertsMockAdapter}, which
 * answers the canned (empty) active set and an empty history, so the shell and
 * its tests need no backend. Live, the same calls hit the real routes; a
 * production build without a backend fails closed.
 *
 * Exercise-scoped (XC-001): the query keys carry `exerciseId` for KEYING only
 * (precedent 13); it is never sent — the server scopes by the session.
 *
 * World: participant. No UI — data only.
 */

import type { AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { isHostRelativePath } from '@/features/channels/contract/guards'
import type { Alert, AlertSeverity } from './alertTypes'

/**
 * All valid alert severities. An out-of-enum `severity` fails closed (the
 * whole response is rejected), never cast blindly to `AlertSeverity`.
 */
const VALID_ALERT_SEVERITIES: readonly AlertSeverity[] = ['info', 'advisory', 'emergency']

function isAlertSeverity(value: unknown): value is AlertSeverity {
  return typeof value === 'string' && (VALID_ALERT_SEVERITIES as readonly string[]).includes(value)
}

/** `scenarioTime` must be a non-empty, `Date.parse`-able ISO instant string. */
function isScenarioTimeString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** An optional additive key: absent, null, or a string passing `check`. */
function isOptional(value: unknown, check: (value: string) => boolean): boolean {
  return value === undefined || value === null || (typeof value === 'string' && check(value))
}

/**
 * The shell's alert guard. Tolerates the extra keys of the wire `AlertDto`
 * (FC-3 superset) and checks the additive ones it uses: `href` must be
 * host-relative (COR-008, FC-9.3) — an absolute or protocol-relative "Details"
 * target would send a participant off the exercise host, so it fails closed.
 */
export function isAlert(value: unknown): value is Alert {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' && value.id.length > 0 &&
    isAlertSeverity(value.severity) &&
    typeof value.message === 'string' && value.message.length > 0 &&
    isScenarioTimeString(value.scenarioTime) &&
    isOptional(value.href, isHostRelativePath) &&
    isOptional(value.sourceChannel, channel => channel.length > 0) &&
    isOptional(value.contentId, id => id.length > 0)
  )
}

/** Wire shape of `GET /alerts` and of the `AlertsChanged` frame: the full active set. */
export interface AlertsBody {
  readonly alerts: readonly Alert[]
}

/** Guards a `GET /alerts` body or an `AlertsChanged` payload (same shape, FC-5). */
export function isAlertsBody(body: unknown): body is AlertsBody {
  return isRecord(body) && Array.isArray(body.alerts) && body.alerts.every(isAlert)
}

/** Wire shape of one `GET /alerts/history` page: newest first, with an opaque cursor. */
export interface AlertsHistoryPage {
  readonly alerts: readonly Alert[]
  readonly nextCursor: string | null
}

function isAlertsHistoryPage(body: unknown): body is AlertsHistoryPage {
  if (!isRecord(body) || !isAlertsBody(body)) return false
  const { nextCursor } = body
  return nextCursor === null || nextCursor === undefined || (typeof nextCursor === 'string' && nextCursor.length > 0)
}

/**
 * The canned ACTIVE set (dev/test only): no active alerts. An ordinary exercise
 * starts with no injects fired, so `none` (zero height) is the correct
 * out-of-the-box state; the bar's other states are tested by mocking the hook.
 */
const MOCK_ALERTS: readonly Alert[] = []

/**
 * Answers both alert reads with the canned set, while still running the shared
 * axios client's request pipeline (base URL, headers, interceptors) exactly as
 * a live call would. History mirrors the active set, so the two never disagree.
 */
export const alertsMockAdapter: AxiosAdapter = config => {
  const isHistory = (config.url ?? '').startsWith('/alerts/history')
  const data: AlertsBody | AlertsHistoryPage = isHistory
    ? { alerts: MOCK_ALERTS, nextCursor: null }
    : { alerts: MOCK_ALERTS }
  return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config })
}

/** The single mock/live flip point (precedent 15). */
export const USE_MOCK_ALERTS = USE_MOCK_DATA

/** React Query key of the active set. */
export function alertsQueryKey(exerciseId: string) {
  return ['participant-shell', 'alert-bar', 'alerts', exerciseId] as const
}

/** React Query key of the history pages. */
export function alertsHistoryQueryKey(exerciseId: string) {
  return ['participant-shell', 'alert-bar', 'alerts-history', exerciseId] as const
}

/** `GET /alerts`: the active set, guarded. */
export async function fetchAlerts(): Promise<readonly Alert[]> {
  const response = await api.get<unknown>(
    '/alerts',
    USE_MOCK_ALERTS ? { adapter: alertsMockAdapter } : undefined,
  )
  if (!isAlertsBody(response.data)) {
    throw new Error('fetchAlerts: the response has a missing or invalid alerts array')
  }
  return response.data.alerts
}

/** `GET /alerts/history`: one page, newest first, guarded. */
export async function fetchAlertsHistory(cursor: string | null): Promise<AlertsHistoryPage> {
  const response = await api.get<unknown>('/alerts/history', {
    ...(cursor === null ? {} : { params: { cursor } }),
    ...(USE_MOCK_ALERTS ? { adapter: alertsMockAdapter } : {}),
  })
  if (!isAlertsHistoryPage(response.data)) {
    throw new Error('fetchAlertsHistory: the response is not an alerts history page')
  }
  return { alerts: response.data.alerts, nextCursor: response.data.nextCursor ?? null }
}
