/**
 * features/social/components/FollowButton.rollbackOrdering.test.tsx
 * ---------------------------------------------------------------------------
 * Regression guard for the rollback defect described in `useFollow.ts`'s
 * target-invalidation effect: the rejected-write rollback must NOT depend on
 * whether React flushed that effect before the user's click.
 *
 * WHY THIS FILE LOOKS UNUSUAL. It deliberately avoids `fireEvent` and
 * `findBy*`. Both are wrapped in `act()`, and act's exit flushes React's
 * pending passive effects — which is exactly the ordering that HIDES the bug.
 * To pin the hazardous ordering instead we poll the raw DOM and dispatch a
 * NATIVE click, so the click handler runs while the mount effect is still
 * pending. Before the fix this failed on every single iteration (60/60 stuck
 * showing "Following"); it is the ONLY shape of test in this suite that
 * reproduces it, which is why the ordinary rollback specs — including
 * `FollowButton.test.tsx`'s — stayed green while the defect was live and only
 * flaked intermittently in loaded CI runs (#391).
 *
 * NOT a flake risk in the other direction: if a future React changes the
 * ordering so the effect always wins, this test still passes (the rollback
 * still happens) — it would merely stop exercising the hazard, which is a
 * coverage question, not an instability.
 */
import type { ReactNode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/core/auth'
import { FollowButton } from './FollowButton'
import { followPersona, unfollowPersona } from '../services/followService'

vi.mock('../services/followService', () => ({
  followPersona: vi.fn(),
  unfollowPersona: vi.fn(),
}))

function withSession(children: ReactNode) {
  return render(<SessionProvider>{children}</SessionProvider>)
}

beforeEach(() => {
  vi.mocked(followPersona).mockRejectedValue(new Error('server refused'))
  vi.mocked(unfollowPersona).mockRejectedValue(new Error('server refused'))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('FollowButton — a rejected write rolls back regardless of effect/click ordering', () => {
  it('never stays stuck on "Following" when the click beats the mount effect flush', async () => {
    withSession(
      <FollowButton personaId="persona-x" displayName="X Persona" initialFollowerCount={5} />,
    )

    // Raw-DOM poll — deliberately NOT `findBy*`, whose act() exit would flush the
    // pending mount effect and so remove the very race under test.
    let button: HTMLElement | null = null
    for (let t = 0; t < 500 && button === null; t++) {
      await tick()
      button = document.querySelector<HTMLElement>('[data-testid="follow-button"]')
    }
    expect(button).not.toBeNull()
    expect(button).toHaveAttribute('aria-pressed', 'false')

    // Native dispatch — no act() wrapper, so the mount effect is still pending.
    button?.click()

    // Let the write reject and every pending effect flush. Generous on purpose:
    // a button still showing "Following" after this cannot be blamed on a slow
    // machine, only on the rollback never having been applied.
    await act(async () => {
      for (let t = 0; t < 10; t++) await tick()
    })

    // The write really was attempted — otherwise "rolled back" would be vacuous,
    // indistinguishable from a click that did nothing at all.
    expect(followPersona).toHaveBeenCalledWith('persona-x')

    const live = document.querySelector<HTMLElement>('[data-testid="follow-button"]')
    expect(live).toHaveAttribute('aria-pressed', 'false')
    expect(live).toHaveAttribute('data-following', 'false')
    expect(live?.textContent?.trim()).toBe('Follow')
  })
})
