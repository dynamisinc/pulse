/**
 * features/social/hooks/useComposeWithLink.readonly.test.tsx
 * ---------------------------------------------------------------------------
 * Channels-foundation 21: in a read-only SESSION (COR-015 / D1-011), even on a `full`
 * mount, `openComposerWithLink` returns `false` and there is no composer. A persona-less
 * session cannot post either, so it gets the same answer. `useSession()` is mocked, so this
 * lives in its own file (as `Composer.readonly.test.tsx` does).
 */
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'

const session = vi.hoisted(() => ({ current: undefined as unknown }))
vi.mock('@/core/auth', () => ({ useSession: () => session.current }))

const { useComposeWithLink } = await import('./useComposeWithLink')

const BASE: Session = {
  exerciseId: 'ex-mock-0001',
  scope: 'exercise',
  personId: null,
  world: 'participant',
  isLead: false,
  accountId: 'acct-observer',
  role: 'participant',
  personaId: 'persona-dreyes_fh',
  actingHumanId: 'human-observer',
  isReadOnly: true,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <ShellContextProvider value={{ variant: 'full', scenarioNow: new Date('2033-09-04T16:00:00Z') }}>
      {children}
    </ShellContextProvider>
  )
}

describe('useComposeWithLink: sessions that cannot post', () => {
  it.each([
    ['a read-only session', { ...BASE }],
    ['a persona-less session', { ...BASE, isReadOnly: false, personaId: undefined }],
  ])('%s: returns false and opens nothing', (_label, value) => {
    session.current = value
    const { result } = renderHook(() => useComposeWithLink(), { wrapper: Shell })

    let opened: boolean | undefined
    act(() => {
      opened = result.current.openComposerWithLink('/news/newsline-7/a-story')
    })

    expect(opened).toBe(false)
    expect(result.current.isOpen).toBe(false)
    expect(result.current.composer).toBeNull()
  })
})
