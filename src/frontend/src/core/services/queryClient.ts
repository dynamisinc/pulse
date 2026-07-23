/**
 * core/services/queryClient.ts
 * ---------------------------------------------------------------------------
 * The app's single shared React Query client. Extracted from `App.tsx` so it
 * is importable by non-component code that must act on the cache directly —
 * specifically `core/auth/endSession.ts`, which clears it on logout so a
 * DIFFERENT user signing in on the same browser tab can never briefly observe
 * the prior user's cached server-state (most queries are keyed WITHOUT a
 * per-user/per-session component — `['staff','assignments']`, the feed,
 * personas, brand/chrome config — so token clearing alone would leave that data
 * resident; a cross-user/cross-exercise client-side bleed the isolation
 * guarantee, COR-001, must not allow). `App.tsx` mounts THIS instance in its
 * `QueryClientProvider`, so `useQueryClient()` in every component returns the
 * same object `endSession()` clears.
 *
 * Sensible React Query defaults. The participant social feed's real-time updates
 * do NOT refetch-on-focus — they ride the shared SignalR transport
 * (`@/core/realtime` → `features/social/services/realtimeFeed`), surfaced through
 * the buffered "▲ N new posts" pill (feeds-discovery/04), with a polling fallback
 * on degrade (NFR-003). That live subscription is turned on by the
 * `USE_MOCK_DATA`-gated source flip in
 * `features/social/services/feedStreamSource.ts` (mock data → the in-tab
 * `postStore`; a real backend → the SignalR transport) — the one composition
 * flip point for the pill, mirroring `feedService`'s `USE_MOCK_FEED`. See D0 §4
 * burst legibility (120 posts/min).
 *
 * World: platform/foundation. Pure `core/` module — no UI, no COBRA.
 */
import { QueryClient } from '@tanstack/react-query'

/** The single shared query client (mounted by `App.tsx`, cleared by `endSession()`). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
