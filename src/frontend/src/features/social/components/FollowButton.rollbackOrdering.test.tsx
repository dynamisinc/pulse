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
import { useEffect, useState, type ReactNode } from 'react'
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

/**
 * Polls the raw DOM on a WALL-CLOCK deadline rather than a tick count. A fixed
 * iteration budget is load-sensitive in the wrong direction: under a starved
 * parallel run the button can legitimately need more ticks than the budget
 * allows, and the test would fail for lack of time rather than for the defect it
 * guards. Mirrors `asyncUtilTimeout` (5000ms, set in `src/test/setup.ts`).
 *
 * `performance.now()`, not `Date.now()`: this is elapsed harness time for a poll
 * deadline, not a timestamp anything renders, so COR-053's scenario-time rule (which
 * bans wall-clock on participant surfaces, this file included) does not apply. Using
 * the monotonic clock keeps that distinction obvious rather than looking like an
 * evasion of the lint rule.
 */
async function pollForButton(matches: (el: HTMLElement) => boolean): Promise<HTMLElement> {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    await tick()
    const candidate = document.querySelector<HTMLElement>('[data-testid="follow-button"]')
    if (candidate !== null && matches(candidate)) return candidate
  }
  throw new Error('timed out waiting for the follow button to reach the expected state')
}

describe('FollowButton — a rejected write rolls back regardless of effect/click ordering', () => {
  it('never stays stuck on "Following" when the click beats the mount effect flush', async () => {
    withSession(
      <FollowButton personaId="persona-x" displayName="X Persona" initialFollowerCount={5} />,
    )

    // Raw-DOM poll — deliberately NOT `findBy*`, whose act() exit would flush the
    // pending mount effect and so remove the very race under test. Returns a
    // non-null element or throws, so no `?.` below can silently no-op the click and
    // leave every later assertion passing without one ever having landed.
    const button = await pollForButton(() => true)
    expect(button).toHaveAttribute('aria-pressed', 'false')

    // Native dispatch — no act() wrapper, so the mount effect is still pending.
    button.click()

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
    if (live === null) throw new Error('the follow button vanished mid-test')
    expect(live).toHaveAttribute('aria-pressed', 'false')
    expect(live).toHaveAttribute('data-following', 'false')
    expect(live.textContent?.trim()).toBe('Follow')
  })

  /**
   * The SECOND ordering hazard (Copilot's finding on #409): skipping the mount bump
   * does not save the first click on a NEWLY TARGETED persona, which can beat the
   * pending bump and be suppressed identically. Only flushing the bump synchronously
   * during commit (`useLayoutEffect`) closes it.
   *
   * `Retargeter` flips `personaId` from a `setTimeout` — i.e. OUTSIDE `act()`, the way
   * a real navigation or resolved query commits. An act-wrapped `rerender()` would
   * flush the pending effect on exit and hide the hazard, exactly as `fireEvent` does.
   */
  it('never stays stuck on "Following" when the click follows a target change', async () => {
    function Retargeter() {
      const [personaId, setPersonaId] = useState('persona-a')
      useEffect(() => {
        const timer = setTimeout(() => setPersonaId('persona-b'), 0)
        return () => clearTimeout(timer)
      }, [])
      return (
        <FollowButton
          personaId={personaId}
          displayName={personaId}
          initialFollowerCount={5}
        />
      )
    }

    withSession(<Retargeter />)

    // Wait for the RETARGETED render specifically — the accessible name carries the
    // persona id, so this cannot pass against the pre-change button.
    const button = await pollForButton(
      el => el.getAttribute('aria-label') === 'Follow persona-b',
    )

    button.click()

    await act(async () => {
      for (let t = 0; t < 10; t++) await tick()
    })

    expect(followPersona).toHaveBeenCalledWith('persona-b')

    const live = document.querySelector<HTMLElement>('[data-testid="follow-button"]')
    if (live === null) throw new Error('the follow button vanished mid-test')
    expect(live).toHaveAttribute('aria-pressed', 'false')
    expect(live.textContent?.trim()).toBe('Follow')
  })
})
