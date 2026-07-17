/**
 * features/participant-shell/shellState.ts
 * ---------------------------------------------------------------------------
 * The shell-state mock seam (feature: participant-shell, story 04; COR-060,
 * XC-001). Mirrors `core/exerciseContext/exerciseContextResolver.ts`'s "mock
 * behind the shared axios client" pattern: every request is routed through
 * `api` so the request shape (method, URL, base URL, headers) matches the
 * future `/shell-state` endpoint, with mock data swapped at exactly ONE
 * env-guarded flip point (WAVE0-REVIEW precedent 15) rather than per call —
 * so a forgotten `adapter:` can't silently fail *open* to mock data in
 * production; a production build without a backend fails closed instead
 * (the query errors rather than serving a canned value).
 *
 * This story owns only the MOUNT-relevant slice of the full `ShellState`
 * envelope (`mountContract.ts`): `variant`. `chromeConfig` content is story
 * 01's `useChromeConfig` seam; `alerts[]` / `overlayState` belong to stories
 * 02 / 05 respectively — none of that is fetched or shipped here.
 * `scenarioNow` is deliberately NOT fetched here either: scenario "now" is
 * client-derived from `@/core/clock` (see `ShellLayout.tsx`), not
 * server-polled, so a channel's timestamps never lag a fetch interval.
 *
 * Uses React Query — the ordinary server-state default (this is cacheable
 * shell config, not the exercise-isolation gate, so RQ's cache/retry
 * behavior is appropriate here; contrast `core/exerciseContext`'s
 * deliberately hand-rolled fail-closed gate, WAVE0-REVIEW precedent 16).
 *
 * Exercise-scoped (XC-001): the React Query key includes the resolved
 * exercise's `exerciseId` so a session switching exercises can never keep
 * serving a stale/other exercise's cached shell state. Per WAVE0-REVIEW
 * precedent 13, `exerciseId` is read from `useExerciseContext()` for this
 * KEYING purpose only — it is never sent to the server as a client-supplied
 * scoping parameter (the mock ignores it entirely; a real endpoint scopes by
 * the authenticated session, server-side).
 *
 * **CR-W1 (Wave-1 Gate-1, fixed here — story 06).** `variant` resolves to
 * `'readOnly'` — never `'full'` — whenever the query has no resolved data
 * yet: loading, errored, or absent. This is the least-affordance default
 * (COR-015/COR-064): a loading frame or a prod fetch failure must never grant
 * interactive affordances (composer/Post/reply/follow) the exercise didn't
 * intend. It's UX/affordance only — read-only integrity is still enforced
 * server-side; a client can forge `full` regardless of what this hook
 * returns. Deliberately do NOT mirror this in `chromeConfig.ts` — that seam's
 * `enabled: true` fallback fails SAFE the opposite way on purpose (keeps
 * classification banners visible, PRT-010/NFR-008); the two seams' fallback
 * directions differ intentionally and should not be reconciled.
 *
 * World: participant. No COBRA, no UI — a pure data hook.
 */

import { useQuery } from '@tanstack/react-query'
import type { AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { useExerciseContext } from '@/core/exerciseContext'
import type { ShellVariant } from './mountContract'

/** The mount-relevant slice of shell state this story resolves. */
export interface ShellStateResult {
  readonly variant: ShellVariant
}

/** Wire shape of the (future) `/shell-state` response body's mount-relevant field. */
interface ShellStateResponseBody {
  readonly variant: ShellVariant
}

/**
 * All valid shell variants. The runtime guard checks membership here so it
 * matches the wire contract — this seam swaps to a live endpoint with no
 * consumer change, so an out-of-enum `variant` must fail closed, not be cast
 * blindly to `ShellVariant`.
 */
const VALID_SHELL_VARIANTS: readonly ShellVariant[] = ['full', 'readOnly', 'kiosk', 'preview']

function isShellVariant(value: unknown): value is ShellVariant {
  return typeof value === 'string' && (VALID_SHELL_VARIANTS as readonly string[]).includes(value)
}

function isValidResponseBody(
  body: ShellStateResponseBody | null | undefined,
): body is ShellStateResponseBody {
  return !!body && isShellVariant(body.variant)
}

/**
 * The one fixed mock shell state this Wave-1 mock resolves to (dev/test
 * only — see `USE_MOCK_SHELL_STATE`). `variant: 'full'` here is the resolved
 * MOCK DATA (ordinary participant conduct once the query settles) — distinct
 * from the `'readOnly'` LOADING/ERROR fallback `useShellState()` returns
 * below (CR-W1); swap this constant + `mockAdapter` for a live `/shell-state`
 * call when the backend lands.
 */
const MOCK_SHELL_STATE: ShellStateResponseBody = {
  variant: 'full',
}

/**
 * Short-circuits the network layer with a canned response so resolution is
 * instant in the current no-backend scaffold, while still exercising the
 * shared axios client's request pipeline (base URL, headers, interceptors)
 * exactly as a live endpoint call would.
 */
const mockAdapter: AxiosAdapter = config => Promise.resolve({
  data: MOCK_SHELL_STATE,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

/**
 * The SINGLE mock/live flip point (WAVE0-REVIEW precedent 15) — mirrors
 * `exerciseContextResolver.ts`'s `USE_MOCK_EXERCISE_CONTEXT`. Mock in
 * dev/test; a production build without a backend fails closed (the query's
 * `data` stays undefined and `useShellState` falls back to `'readOnly'`
 * (CR-W1) — it never silently serves mock content, and a fetch failure never
 * grants `full` interaction).
 */
const USE_MOCK_SHELL_STATE = import.meta.env.DEV

async function fetchShellState(): Promise<ShellStateResult> {
  const response = await api.get<ShellStateResponseBody>(
    '/shell-state',
    USE_MOCK_SHELL_STATE ? { adapter: mockAdapter } : undefined,
  )

  if (!isValidResponseBody(response.data)) {
    throw new Error(
      'fetchShellState: mock resolution returned a missing or invalid variant',
    )
  }

  return { variant: response.data.variant }
}

/**
 * The least-affordance fallback (CR-W1, Wave-1 Gate-1 — fixed in story 06).
 * `useShellState()` resolves to THIS, never `'full'`, whenever the query has
 * no resolved data yet (loading, errored, or absent), so a loading frame or a
 * prod fetch failure never grants interaction the exercise didn't intend.
 * See the module header for the full rationale and the deliberate contrast
 * with `chromeConfig.ts`'s opposite-direction (fail-SAFE, `enabled: true`)
 * fallback — do NOT align that seam to this one.
 */
const LEAST_AFFORDANCE_VARIANT: ShellVariant = 'readOnly'

/**
 * Resolves the current exercise's shell-mount state (today: `variant` only).
 *
 * Exercise-scoped via the React Query key (see module header). `variant`
 * falls back to {@link LEAST_AFFORDANCE_VARIANT} (`'readOnly'`, CR-W1)
 * whenever the query has no resolved data yet — while loading, on error, or
 * absent — so `ShellLayout` always has a usable variant to hand a channel;
 * it never renders a channel against an "unknown" variant, and it never
 * defaults to `'full'` before the exercise's real variant is confirmed.
 */
export function useShellState(): ShellStateResult {
  const { exerciseId } = useExerciseContext()

  const { data } = useQuery({
    queryKey: ['participant-shell', 'shell-state', exerciseId],
    queryFn: fetchShellState,
  })

  return { variant: data?.variant ?? LEAST_AFFORDANCE_VARIANT }
}
