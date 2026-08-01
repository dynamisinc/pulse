/**
 * features/social/components/FollowButton.test.tsx
 * ---------------------------------------------------------------------------
 * Covers story-02 ACs for the standalone follow/unfollow control (SOC-051,
 * NFR-001):
 *   - renders "Follow {name}" initially, and toggles to "Following" on
 *     activation, with `aria-pressed` reflecting the state (never color
 *     alone);
 *   - calls `onFollowerCountChange` with the running optimistic count;
 *   - a rejected write rolls the button (and the reported count) back to
 *     "Follow".
 *
 * (Observer/no-persona "control absent" ACs live in the sibling
 * `FollowButton.readonly.test.tsx` / `FollowButton.noPersona.test.tsx`, which
 * mock a read-only / personaless session — same file-split rationale as
 * `useReaction`'s specs.)
 *
 * Runs through the REAL `SessionProvider` (a normal, writable participant —
 * mirrors `useFollow.test.ts`), with `followService` mocked so this file
 * exercises ONLY the component's own render/interaction contract.
 */
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/core/auth'
import { FollowButton } from './FollowButton'
import { followPersona, unfollowPersona } from '../services/followService'
import type { FollowWriteResult } from '../services/followService'

vi.mock('../services/followService', () => ({
  followPersona: vi.fn(),
  unfollowPersona: vi.fn(),
}))

function withSession(children: ReactNode) {
  return render(<SessionProvider>{children}</SessionProvider>)
}

/**
 * Asserts the button's follow state — the same discriminating-signal helper the
 * sibling `Profile.follow.test.tsx` uses, and for the same reason.
 *
 * Deliberately NOT `toHaveTextContent('Follow')`: that matcher is a SUBSTRING
 * match, so "Follow" also matches "Following". An assertion written that way
 * passes against a button stuck in the WRONG state, and — worse — a `waitFor`
 * gated on it resolves immediately instead of waiting for the transition it is
 * supposed to be waiting for, so whatever follows the gate races the render
 * (this file's rollback spec flaked exactly that way under CI load).
 * `aria-pressed` is the unambiguous signal (and the one assistive tech reports,
 * NFR-001); the exact trimmed label is checked alongside it.
 */
function expectFollowState(button: HTMLElement, following: boolean) {
  expect(button).toHaveAttribute('aria-pressed', String(following))
  expect(button).toHaveAttribute('data-following', String(following))
  expect(button.textContent?.trim()).toBe(following ? 'Following' : 'Follow')
}

beforeEach(() => {
  // Resolves with the server's authoritative envelope (SG-001) — `following`
  // `true` for a follow / `false` for an unfollow, with `changed: true` because
  // each write really moves the edge.
  vi.mocked(followPersona).mockResolvedValue({ following: true, changed: true })
  vi.mocked(unfollowPersona).mockResolvedValue({ following: false, changed: true })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('FollowButton — toggle + accessible state (SOC-051, NFR-001)', () => {
  it('renders "Follow" with aria-pressed=false, then toggles to "Following" with aria-pressed=true', async () => {
    withSession(
      <FollowButton
        personaId="persona-fairhavenwater"
        displayName="Fairhaven Water"
        initialFollowerCount={120}
      />,
    )

    const button = await screen.findByTestId('follow-button')
    expectFollowState(button, false)
    expect(button).toHaveAttribute('aria-label', 'Follow Fairhaven Water')

    fireEvent.click(button)

    expectFollowState(button, true)
    expect(button).toHaveAttribute('aria-label', 'Unfollow Fairhaven Water')

    await waitFor(() => expect(followPersona).toHaveBeenCalledWith('persona-fairhavenwater'))
  })

  it('reports the running optimistic follower count via onFollowerCountChange', async () => {
    const onFollowerCountChange = vi.fn()
    withSession(
      <FollowButton
        personaId="persona-x"
        displayName="X Persona"
        initialFollowerCount={10}
        onFollowerCountChange={onFollowerCountChange}
      />,
    )

    const button = await screen.findByTestId('follow-button')
    await waitFor(() => expect(onFollowerCountChange).toHaveBeenCalledWith(10))

    fireEvent.click(button)
    expect(onFollowerCountChange).toHaveBeenCalledWith(11)
  })

  it('rolls back to "Follow" when the write is rejected — never stuck showing Following', async () => {
    vi.mocked(followPersona).mockRejectedValue(new Error('server refused'))

    withSession(
      <FollowButton personaId="persona-x" displayName="X Persona" initialFollowerCount={5} />,
    )

    const button = await screen.findByTestId('follow-button')
    fireEvent.click(button)
    expectFollowState(button, true) // optimistic

    // The gate is the ROLLBACK itself, not a substring both states satisfy.
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'false'))
    expectFollowState(button, false)
  })

  it('marks the button aria-busy + disabled while the write is pending', async () => {
    let releaseWrite: (() => void) | undefined
    vi.mocked(followPersona).mockImplementation(
      () => new Promise<FollowWriteResult>(resolve => {
        releaseWrite = () => resolve({ following: true, changed: true })
      }),
    )

    withSession(
      <FollowButton personaId="persona-x" displayName="X Persona" initialFollowerCount={5} />,
    )

    const button = await screen.findByTestId('follow-button')
    fireEvent.click(button)

    // GATE, don't sample. The write above is a DEFERRED promise that only
    // settles when `releaseWrite()` is called below, so the pending window is
    // held open for the whole of this gate: it can be satisfied ONLY by
    // observing `aria-busy`/`disabled` actually turn on, never by the write
    // settling out from under it. A bare synchronous `expect` here instead
    // races the click's commit and flaked under a loaded parallel run — same
    // async-render race class as this file's rollback spec (see the
    // `expectFollowState` note above), never shared-state bleed.
    await waitFor(() => {
      expect(button).toHaveAttribute('aria-busy', 'true')
      expect(button).toBeDisabled()
    })

    // Releasing is what CLOSES the window. Throw rather than `?.()`-no-op if
    // the write was never issued: otherwise the settle assertion below would
    // pass vacuously against a button that had never gone busy at all.
    if (!releaseWrite) throw new Error('followPersona was never called — no write to release')
    releaseWrite()

    await waitFor(() => expect(button).not.toBeDisabled())
    expect(button).toHaveAttribute('aria-busy', 'false')
  })
})
