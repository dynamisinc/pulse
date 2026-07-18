/**
 * features/participant-shell/components/OverlayLayer/overlayState.ts
 * ---------------------------------------------------------------------------
 * The overlay-state mock seam (feature: participant-shell, story 05; COR-065,
 * XC-001; see docs/features/participant-shell/05-overlay-layer.md and
 * docs/design/D7-application-shells/SHELL-CONTRACT.md §3).
 *
 * Mirrors `../../shellState.ts` / `../../chromeConfig.ts`'s "mock behind the
 * shared axios client" pattern exactly: every request routes through `api` so
 * the request shape (method, URL, base URL, headers) matches the future
 * `/overlay-state` endpoint, with mock data swapped at exactly ONE
 * env-guarded flip point (WAVE0-REVIEW precedent 15) rather than per call —
 * a production build without a backend fails CLOSED (the query errors;
 * `useOverlayState()` falls back to the safe `'none'` default below, it never
 * invents or serves stale overlay content).
 *
 * Eventual transport (CLAUDE.md §G): overlay pushes are server state that
 * will ultimately arrive over the shared SignalR connection (one connection,
 * new handlers added to it) rather than polling — the real-time work is out
 * of scope for this story. This Wave-1 mock uses the same React-Query-behind-
 * axios seam as the rest of the shell so the query/cache/consumer shape is
 * already correct; only `fetchOverlayState`'s transport changes when that
 * lands, not `useOverlayState()`'s return contract.
 *
 * This story owns the TYPES (`./types.ts`) and this mock resolution only. It
 * does NOT build the triggers that set overlay state server-side — Break
 * Fiction's guarded control (world-steering #27) and tiered-pause's control +
 * state machine (world-steering #26) are explicitly out of scope (STORY-
 * UPDATES §B); this seam only RENDERS whatever state resolves.
 *
 * Exercise-scoped (XC-001): the React Query key includes the resolved
 * exercise's `exerciseId`, read from `useExerciseContext()` for KEYING only
 * (WAVE0-REVIEW precedent 13) — never sent to the server as a client-supplied
 * scoping parameter (the mock ignores it entirely; a real endpoint scopes by
 * the authenticated session, server-side).
 *
 * Uses React Query — this is cacheable shell state, exactly like
 * `shellState.ts`/`chromeConfig.ts` (contrast `core/exerciseContext`'s
 * deliberately hand-rolled fail-closed gate, WAVE0-REVIEW precedent 16).
 *
 * World: participant. No COBRA, no UI — a pure data hook.
 */

import { useQuery } from '@tanstack/react-query'
import type { AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { useExerciseContext } from '@/core/exerciseContext'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import type { OverlayRegister, OverlayState, OverlayStateKind } from './types'

/** Wire shape of the (future) `/overlay-state` response body. */
type OverlayStateResponseBody = OverlayState

/**
 * All valid overlay states / registers. The runtime guards check membership
 * here so they match the wire contract — this seam swaps to a live endpoint
 * with no consumer change, so an out-of-enum value must fail closed, not be
 * cast blindly.
 */
const VALID_OVERLAY_STATE_KINDS: readonly OverlayStateKind[] = [
  'none',
  'pause',
  'endex',
  'broadcast',
]
const VALID_OVERLAY_REGISTERS: readonly OverlayRegister[] = ['in-fiction', 'out-of-fiction']

function isOverlayStateKind(value: unknown): value is OverlayStateKind {
  return typeof value === 'string' && (VALID_OVERLAY_STATE_KINDS as readonly string[]).includes(value)
}

function isOverlayRegister(value: unknown): value is OverlayRegister {
  return typeof value === 'string' && (VALID_OVERLAY_REGISTERS as readonly string[]).includes(value)
}

function isValidResponseBody(
  body: OverlayStateResponseBody | null | undefined,
): body is OverlayStateResponseBody {
  return (
    !!body &&
    isOverlayStateKind(body.state) &&
    isOverlayRegister(body.register) &&
    typeof body.message === 'string'
  )
}

/**
 * The safe fixed mock this Wave-1 seam resolves to (dev/test only — see
 * `USE_MOCK_OVERLAY_STATE`): no overlay active. This story renders mock
 * overlay state; it does not build a trigger UI to flip it (see module
 * header) — exercising the `'pause'`/`'endex'`/`'broadcast'` branches is a
 * test-time concern (mocking `useOverlayState` at the module boundary).
 */
const MOCK_OVERLAY_STATE: OverlayStateResponseBody = {
  state: 'none',
  register: 'in-fiction',
  message: '',
}

/**
 * Short-circuits the network layer with a canned response so resolution is
 * instant in the current no-backend scaffold, while still exercising the
 * shared axios client's request pipeline (base URL, headers, interceptors)
 * exactly as a live endpoint call would.
 */
const mockAdapter: AxiosAdapter = config => Promise.resolve({
  data: MOCK_OVERLAY_STATE,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

/**
 * The SINGLE mock/live flip point (WAVE0-REVIEW precedent 15) — mirrors
 * `shellState.ts`'s `USE_MOCK_SHELL_STATE`. Mock in dev/test; a production
 * build without a backend fails closed (the query errors rather than serving
 * a canned state).
 */
const USE_MOCK_OVERLAY_STATE = USE_MOCK_DATA

async function fetchOverlayState(): Promise<OverlayState> {
  const response = await api.get<OverlayStateResponseBody>(
    '/overlay-state',
    USE_MOCK_OVERLAY_STATE ? { adapter: mockAdapter } : undefined,
  )

  if (!isValidResponseBody(response.data)) {
    throw new Error(
      'fetchOverlayState: mock resolution returned a missing or invalid overlay state',
    )
  }

  return {
    state: response.data.state,
    register: response.data.register,
    message: response.data.message,
  }
}

/**
 * The safe default `useOverlayState()` falls back to whenever the query has
 * no resolved data yet — while loading, on error, or absent: no overlay,
 * `'in-fiction'` register, no message. A channel/shell must never be blocked
 * from rendering because this query hasn't resolved, and it must never
 * default to SHOWING an overlay it wasn't told to show.
 */
const DEFAULT_OVERLAY_STATE: OverlayState = {
  state: 'none',
  register: 'in-fiction',
  message: '',
}

/**
 * Resolves the current exercise's overlay state (`OverlayLayer.tsx`'s sole
 * data dependency — see that module for the self-contained mount contract).
 *
 * Exercise-scoped via the React Query key (see module header). Falls back to
 * `DEFAULT_OVERLAY_STATE` (`'none'`) whenever the query has no resolved data
 * yet, so the overlay layer never renders against a partial/undefined value
 * and never fails OPEN into showing an overlay nobody triggered.
 */
export function useOverlayState(): OverlayState {
  const { exerciseId } = useExerciseContext()

  const { data } = useQuery({
    queryKey: ['participant-shell', 'overlay-state', exerciseId],
    queryFn: fetchOverlayState,
  })

  return data ?? DEFAULT_OVERLAY_STATE
}
