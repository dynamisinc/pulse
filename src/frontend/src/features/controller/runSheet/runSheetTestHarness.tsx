/**
 * features/controller/runSheet/runSheetTestHarness.tsx
 * ---------------------------------------------------------------------------
 * TEST-ONLY helpers for the run-sheet suites (never imported by product code):
 *
 *   - `renderRunSheet(ui)` mounts `ui` under the same provider stack the console route
 *     gives the panel — the COBRA theme (staff world), the REAL `ExerciseContextProvider`
 *     (resolved through the shared axios dev mock adapter) and a fresh React Query
 *     client with retries off.
 *   - `makeItem` / `makePost` build wire DTOs for the pure and row-level tests.
 *
 * Panel-level tests drive the in-memory mock (`injectMock`) so the full state machine,
 * 409s and burst pacing are the REAL mock behaviour, not hand-faked responses.
 */

/* eslint-disable react-refresh/only-export-components -- test-only helper: `createWrapper`
   returns a component for `renderHook`; fast refresh never applies to a test harness. */
import type { ReactElement, ReactNode } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import type { InjectItemDto, InjectPostDto } from './types'

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function Providers({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <ThemeProvider theme={cobraTheme}>
      <QueryClientProvider client={client}>
        <ExerciseContextProvider>{children}</ExerciseContextProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

/** The provider stack as a wrapper component (for `renderHook`). */
export function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Providers client={client}>{children}</Providers>
  }
}

export function renderRunSheet(
  ui: ReactElement,
  queryClient: QueryClient = makeQueryClient(),
): RenderResult & { queryClient: QueryClient } {
  // The exercise provider renders nothing until its scope resolves; callers `findBy*` what
  // they need (RTL's async window is 5 s, see `src/test/setup.ts`).
  const result = render(<Providers client={queryClient}>{ui}</Providers>)
  return { ...result, queryClient }
}

export function makePost(overrides: Partial<InjectPostDto> = {}): InjectPostDto {
  return {
    id: 'injp-1',
    sequence: 1,
    status: 'pending',
    personaId: 'persona-fairhavenwater',
    text: 'A boil-water advisory is in effect.',
    ...overrides,
  }
}

export function makeItem(overrides: Partial<InjectItemDto> = {}): InjectItemDto {
  const posts = overrides.posts ?? [makePost()]
  return {
    id: 'inj-1',
    kind: 'post',
    title: 'Boil-water advisory',
    order: 1,
    status: 'pending',
    posts,
    firedCount: posts.filter(p => p.status === 'fired').length,
    total: posts.length,
    version: 1,
    createdByHumanId: 'human-controller-01',
    updatedAt: '2033-09-04T14:00:00.000Z',
    ...overrides,
  }
}
